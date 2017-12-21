const dotenv = require('dotenv');
const yargs = require('yargs');
const moment = require('moment');
const google = require('googleapis');
const { stripIndents } = require('common-tags');
const { URL } = require('url');
const {
  differenceWith,
  head,
  includes,
  isEqual,
  orderBy,
  partition,
  sumBy,
  take
} = require('lodash');

dotenv.config();

const VIEW_ID = process.env.VIEW_ID;
const credentials = require('./credentials.json');
const liveRoutes = require(`${
  process.env.APP_DIR
}/config/cloudfront/live.json`);

const analytics = google.analytics('v3');

const argv = yargs
  .option('start', {
    alias: 's',
    description: 'Supply a date to start the lookup from (YYYY-MM-DD)',
    default: '30daysAgo',
    coerce: arg => (moment(arg, 'YYYY-MM-DD').isValid() ? arg : '30daysAgo')
  })
  .option('end', {
    alias: 'e',
    description: 'Supply a date to end the lookup from (YYYY-MM-DD)',
    default: 'yesterday',
    coerce: arg => (moment(arg, 'YYYY-MM-DD').isValid() ? arg : 'yesterday')
  })
  .option('levels', {
    description: 'Levels to collapse URLs down to',
    defaultDescription: 'all, strips query strings only',
    type: 'number',
  })
  .option('percentage', {
    description: 'Percentage of traffic to target',
    default: 80,
    type: 'number'
  })
  .option('csv', {
    description: 'Write results to a CSV'
  })
  .help('h')
  .alias('h', 'help')
  .wrap(Math.min(120, yargs.terminalWidth())).argv;

function log(str) {
  console.log('');
  console.log(stripIndents`${str}`);
  console.log('');
}

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

const cleaningMethods = {
  query(originalUrl) {
    const newUrl = new URL(originalUrl);
    if (includes(newUrl.pathname, '/~/link.aspx')) {
      return newUrl.href;
    } else {
      const cleanedPath = head(newUrl.pathname.split('?'));
      return `${newUrl.origin}${cleanedPath}`;
    }
  },

  sections(originalUrl, levels) {
    const newUrl = new URL(originalUrl);
    // +1 to levels to accout for top-level being the domain.
    const cleanedPath = take(newUrl.pathname.split('/'), levels + 1).join('/');
    return `${newUrl.origin}${cleanedPath}`;
  }
};

function cleanUrl(originalUrl) {
  if (argv.levels) {
    return cleaningMethods.sections(originalUrl, argv.levels);
  } else {
    return cleaningMethods.query(originalUrl);
  }
}

function processQueryRows(queryRows) {
  const mapResults = row => {
    const [urlPath, pageviews] = row;
    const originalUrl = `https://www.biglotteryfund.org.uk${encodeURI(
      urlPath
    )}`;

    return {
      originalUrl: originalUrl,
      cleanUrl: cleanUrl(originalUrl),
      pageviews: parseInt(pageviews, 10)
    };
  };

  const combinePageviewsReducer = (collection, currentRow) => {
    const match = collection.find(row => row.cleanUrl === currentRow.cleanUrl);
    if (match) {
      match.pageviews = match.pageviews + currentRow.pageviews;
    } else {
      collection.push(currentRow);
    }
    return collection;
  };

  return orderBy(
    queryRows.map(mapResults).reduce(combinePageviewsReducer, []),
    ['pageviews'],
    ['desc']
  );
}

function limitUpToPercentage({ results, targetPercentage, totalPageViews }) {
  let count = 0;
  return results.filter(u => {
    count += u.pageviews;
    const pageviewsRequiredForTarget = totalPageViews / 100 * targetPercentage;
    return count < pageviewsRequiredForTarget;
  });
}

function analyse({ queryRows, targetPercentage, totalPageViews }) {
  const allResults = processQueryRows(queryRows);

  const resultsUpToTarget = limitUpToPercentage({
    results: allResults,
    targetPercentage: targetPercentage,
    totalPageViews: totalPageViews
  });

  const [replacedPages, pagesToReplace] = partition(resultsUpToTarget, row => {
    const livePaths = liveRoutes.map(route =>
      route.PathPattern.replace('*', '')
    );
    return includes(livePaths, new URL(row.cleanUrl).pathname);
  });

  const replacedTotalPageviews = sumBy(replacedPages, 'pageviews');

  const replacedPercentage = Math.round(
    replacedTotalPageviews / totalPageViews * 100
  );

  return {
    allResults,
    replacedPages,
    replacedTotalPageviews,
    replacedPercentage,
    pagesToReplace,
    totalPageViews,
    targetPercentage
  };
}

function summarise(analysis) {
  log(`
    Here are the pages we have yet to replace, which will get us to ${
      analysis.targetPercentage
    }%:

    ${analysis.pagesToReplace
      .map((row, i) => `${i + 1}. ${row.cleanUrl} (${row.pageviews} pageviews)`)
      .join('\n')}

    There are ${analysis.allResults.length} unique URLs accessed in this period.
    This covers ${analysis.totalPageViews} total pageviews.
    If we want to reach ${
      analysis.targetPercentage
    }% of pageviews, we need to replace ${analysis.pagesToReplace.length} pages.
    We have already replaced ${
      analysis.replacedPages.length
    } pages, which gets us to ${analysis.replacedPercentage}% already.
  `);
}

function writeCsv(pagesToReplace) {
  const csv = require('fast-csv');
  csv
    .writeToPath(
      'results.csv',
      pagesToReplace.map(row => {
        return [row.cleanUrl, row.pageviews];
      })
    )
    .on('finish', function() {
      console.log('Results written to CSV');
    });
}

const jwtClient = new google.auth.JWT(
  credentials.client_email,
  null,
  credentials.private_key,
  ['https://www.googleapis.com/auth/analytics.readonly'],
  null
);

log('Authorising');

jwtClient.authorize(function(err, tokens) {
  if (err) {
    console.log(err);
    return;
  }

  log(`Fetching analytics data for ${argv.start}–${argv.end}`);

  if (argv.levels) {
    log(`Flattening urls down to ${argv.levels}`);
  }

  queryData({
    auth: jwtClient,
    ids: VIEW_ID,
    metrics: 'ga:uniquePageviews',
    dimensions: 'ga:pagePath',
    'start-date': argv.start,
    'end-date': argv.end,
    sort: '-ga:uniquePageviews',
    filters: 'ga:pagePath!@.pdf',
    'max-results': 10000
  })
    .then(data => {
      const analysis = analyse({
        queryRows: data.rows,
        targetPercentage: argv.percentage,
        totalPageViews: parseInt(
          data.totalsForAllResults['ga:uniquePageviews'],
          10
        )
      });

      summarise(analysis);

      if (argv.csv) {
        writeCsv(analysis.pagesToReplace);
      }
    })
    .catch(err => console.log(err));
});
