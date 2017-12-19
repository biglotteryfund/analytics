require('dotenv').config();
const { head, orderBy, differenceWith, isEqual } = require('lodash');
const credentials = require('./credentials.json');
const google = require('googleapis');
const analytics = google.analytics('v3');
const VIEW_ID = process.env.VIEW_ID;
const liveRoutes = require(`${
  process.env.APP_DIR
}/config/cloudfront/live.json`);
const moment = require('moment');

const argv = require('yargs')
  .alias('s', 'start')
  .describe('s', 'Supply a date to start the lookup from (YYYY-MM-DD)')
  .alias('e', 'end')
  .describe('e', 'Supply a date to end the lookup from (YYYY-MM-DD)')
  .help('h')
  .alias('h', 'help').argv;

const startDate =
  argv.s && moment(argv.s, 'YYYY-MM-DD').isValid() ? argv.s : '30daysAgo';
  const endDate =
  argv.e && moment(argv.e, 'YYYY-MM-DD').isValid() ? argv.e : 'yesterday';

function queryData(query) {
  return new Promise((resolve, reject) => {
    analytics.data.ga.get(query, function(err, response) {
      if (err) {
        reject(err);
      }
      resolve(response);
    });
  });
}

function analyse({ queryRows, totalPageViews }) {
  const cleanedRows = queryRows.map(row => {
    const [fullUrl, pageviews] = row;

    return {
      fullUrl: fullUrl,
      cleanUrl:
        fullUrl.indexOf('/~/link.aspx') !== -1
          ? fullUrl
          : head(fullUrl.split('?')),
      pageviews: parseInt(pageviews, 10)
    };
  });

  const finalScores = cleanedRows.reduce((collection, currentRow) => {
    const match = collection.find(row => row.cleanUrl === currentRow.cleanUrl);
    if (match) {
      match.pageviews = match.pageviews + currentRow.pageviews;
    } else {
      collection.push(currentRow);
    }
    return collection;
  }, []);

  const orderedFinalScores = orderBy(finalScores, ['pageviews'], ['desc']);

  const targetPercentage = 80;
  const pageviewsRequiredForTarget = totalPageViews / 100 * targetPercentage;

  let count = 0;
  const urlsToTarget = orderedFinalScores.filter(u => {
    count += u.pageviews;
    return count < pageviewsRequiredForTarget;
  });

  let livePaths = liveRoutes.map(_ => _.PathPattern.replace('*', ''));
  let targetPaths = urlsToTarget.map(_ => _.cleanUrl);
  let urlsToReplace = differenceWith(targetPaths, livePaths, isEqual);

  console.log(`Using stats from: ${startDate} - ${endDate}\n`);
  console.log(
    `Here are the pages we have yet to replace, which will get us to ${targetPercentage}%:\n`
  );

  let replacedTotal = 0;
  urlsToTarget
    .filter(row => {
      let alreadyReplaced =
        livePaths.indexOf(row.cleanUrl.toLowerCase()) !== -1;
      if (alreadyReplaced) {
        replacedTotal += row.pageviews;
      }
      return !alreadyReplaced;
    })
    .map((row, i) => {
      console.log(
        `\t${i + 1}. https://www.biglotteryfund.org.uk${row.cleanUrl} (${
          row.pageviews
        } pageviews)`
      );
    });

  let replacedPercentage = Math.round(replacedTotal / totalPageViews * 100);

  console.log(`
    - There are ${
      orderedFinalScores.length
    } unique URLs accessed in this period.
    - This covers ${totalPageViews} total pageviews.
    - If we want to reach ${targetPercentage}% of pageviews, we need to replace ${
    urlsToReplace.length
  } pages.
    - We have already replaced ${urlsToTarget.length -
      urlsToReplace.length} pages, which gets us to ${replacedPercentage}% already.
  `);
}

const jwtClient = new google.auth.JWT(
  credentials.client_email,
  null,
  credentials.private_key,
  ['https://www.googleapis.com/auth/analytics.readonly'],
  null
);

jwtClient.authorize(function(err, tokens) {
  if (err) {
    console.log(err);
    return;
  }

  queryData({
    auth: jwtClient,
    ids: VIEW_ID,
    metrics: 'ga:uniquePageviews',
    dimensions: 'ga:pagePath',
    'start-date': startDate,
    'end-date': endDate,
    sort: '-ga:uniquePageviews',
    filters: 'ga:pagePath!@.pdf',
    'max-results': 10000
  })
    .then(data => {
      analyse({
        queryRows: data.rows,
        totalPageViews: parseInt(
          data.totalsForAllResults['ga:uniquePageviews'],
          10
        )
      });
    })
    .catch(err => console.log(err));
});
