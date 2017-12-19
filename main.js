// See: http://2ality.com/2015/10/google-analytics-api.html
require('dotenv').config();
const { head, orderBy } = require('lodash');
const credentials = require('./credentials.json');
const google = require('googleapis');
const analytics = google.analytics('v3');
const VIEW_ID = process.env.VIEW_ID;

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
      cleanUrl: fullUrl.indexOf('/~/link.aspx') !== -1 ? fullUrl : head(fullUrl.split('?')),
      pageviews: parseInt(pageviews, 10)
    }
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

  console.log(`
    There are ${orderedFinalScores.length} unique URLs accessed in this period.
    This covers ${totalPageViews} total pageviews.
    If we want to replace ${targetPercentage}% of these pages with new ones, we need to replace ${urlsToTarget.length} of them
  `);

  urlsToTarget.map(row => {
    const urlPath = row.cleanUrl.replace('www.biglotteryfund.org.uk', '');
    console.log(`${urlPath} (${row.pageviews} pageviews)`)
  });
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
    // 'start-date': '2017-12-11',
    // 'end-date': '2017-12-17',
    'start-date': '30daysAgo',
    'end-date': 'yesterday',
    sort: '-ga:uniquePageviews',
    filters: 'ga:pagePath!@.pdf'
  }).then(data => {
    analyse({
      queryRows: data.rows,
      totalPageViews: parseInt(data.totalsForAllResults['ga:uniquePageviews'], 10),
    })
  }).catch(err => console.log(err));
});