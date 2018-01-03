#!/usr/bin/env node

const dotenv = require('dotenv');
const yargs = require('yargs');
const moment = require('moment');
const google = require('googleapis');
const { stripIndents } = require('common-tags');
const { URL } = require('url');
const {
  differenceWith,
  flow,
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

const globalArgv = yargs
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
  .option('csv', {
    description: 'Write results to a CSV'
  })
  .command(
    'query',
    'Query tools',
    yargs => {
      return yargs
        .option('path', {
          alias: 'p',
          description: 'Limit query to a given path',
          demandOption: true
        })
        .option('min-pageviews', {
          description: 'Filter out results below a minimum number of pageviews',
          type: 'number'
        });
    },
    argv => {
      if (argv.minPageviews) {
        console.log(
          `Limiting to pages with at least ${argv.minPageviews} pageviews`
        );
      }

      queryData({
        filters: `ga:pagePath=~${argv.path};ga:pageviews>${argv.minPageviews ||
          0}`
      })
        .then(data => {
          const allResults = processQueryRows(
            data.rows,
            flow(cleaningMethods.defaults(), cleaningMethods.removeRegion())
          );

          loga([
            `Pages for path ${argv.path}`,
            listPages(allResults),
            `${allResults.length} total pages`
          ]);

          if (globalArgv.csv) {
            writeCsv(allResults);
          }
        })
        .catch(err => console.log(err));
    }
  )
  .command(
    'migration',
    'Migration summary',
    yargs => {
      return yargs
        .option('levels', {
          description: 'Levels to collapse URLs down to',
          defaultDescription: 'all, strips query strings only',
          type: 'number'
        })
        .option('path-query', {
          description: 'Limit query to a given URL path'
        })
        .option('percentage', {
          description: 'Percentage of traffic to target',
          default: 80,
          type: 'number'
        });
    },
    argv => {
      function limitUpToPercentage({
        results,
        targetPercentage,
        totalPageViews
      }) {
        let count = 0;
        return results.filter(u => {
          count += u.pageviews;
          const pageviewsRequiredForTarget =
            totalPageViews / 100 * targetPercentage;
          return count < pageviewsRequiredForTarget;
        });
      }

      function analyse({ queryRows, targetPercentage, totalPageViews }) {
        const cleaningFn = argv.levels
          ? flow(
              cleaningMethods.defaults(),
              cleaningMethods.flattenLevels(argv.levels)
            )
          : cleaningMethods.defaults();

        const allResults = processQueryRows(queryRows, cleaningFn);

        const resultsUpToTarget = limitUpToPercentage({
          results: allResults,
          targetPercentage: targetPercentage,
          totalPageViews: totalPageViews
        });

        const [replacedPages, pagesToReplace] = partition(
          resultsUpToTarget,
          row => {
            const livePaths = liveRoutes.map(route =>
              route.PathPattern.replace('*', '')
            );
            return includes(livePaths, new URL(row.cleanUrl).pathname);
          }
        );

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

          ${listPages(analysis.pagesToReplace)}

          There are ${
            analysis.allResults.length
          } unique URLs accessed in this period.
          This covers ${analysis.totalPageViews} total pageviews.
          If we want to reach ${
            analysis.targetPercentage
          }% of pageviews, we need to replace ${
          analysis.pagesToReplace.length
        } pages.
          We have already replaced ${
            analysis.replacedPages.length
          } pages, which gets us to ${analysis.replacedPercentage}% already.
        `);
      }

      queryData({
        filters: 'ga:pagePath!@.pdf'
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

          if (globalArgv.csv) {
            writeCsv(analysis.pagesToReplace);
          }
        })
        .catch(err => console.log(err));
    }
  )
  .command(
    '$0',
    'the default command',
    () => {},
    () => {
      console.log('Show available commands with --help');
    }
  )
  .help()
  .wrap(Math.min(120, yargs.terminalWidth())).argv;

function log(str) {
  console.log('');
  console.log(stripIndents`${str}`);
  console.log('');
}

function loga(strs) {
  return strs.map(log);
}

function listPages(pages) {
  const digits = pages.length.toString().length;
  return pages
    .map(
      (row, i) =>
        `${(i + 1).toString().padStart(digits, '0')}. ${row.cleanUrl} (${
          row.pageviews
        } pageviews)`
    )
    .join('\n');
}

const cleaningMethods = {
  trailingSlash() {
    return urlPath => {
      const hasTrailingSlash = s => s[s.length - 1] === '/' && s.length > 1;
      if (hasTrailingSlash(urlPath)) {
        urlPath = urlPath.substring(0, urlPath.length - 1);
      }
      return urlPath;
    };
  },
  queryStrings() {
    return urlPath => {
      if (includes(urlPath, '/~/link.aspx')) {
        return urlPath;
      } else {
        const cleanedPath = head(urlPath.split('?'));
        return cleanedPath;
      }
    };
  },
  flattenLevels(levels) {
    return urlPath => {
      // +1 to levels to account for top-level being the domain.
      const cleanedPath = take(urlPath.split('/'), levels + 1).join('/');
      return cleanedPath;
    };
  },
  removeRegion() {
    return urlPath => {
      const cleanedPath = urlPath
        .replace(/^\/uk-wide/, '')
        .replace(/^\/england/, '')
        .replace(/^\/wales/, '')
        .replace(/^\/scotland/, '')
        .replace(/^\/northernireland/, '')
        .replace(/^\/welsh/, '');
      return cleanedPath;
    };
  }
};

cleaningMethods.defaults = () => {
  return urlPath => {
    return flow(
      cleaningMethods.queryStrings(),
      cleaningMethods.trailingSlash()
    )(urlPath);
  };
};

function processQueryRows(queryRows, cleaningFn) {
  const fullUrl = urlPath =>
    `https://www.biglotteryfund.org.uk${encodeURI(urlPath)}`;

  const mapResults = row => {
    const [urlPath, pageviews] = row;
    return {
      originalUrl: fullUrl(urlPath),
      cleanUrl: fullUrl(cleaningFn(urlPath.toLowerCase())),
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

function queryData(queryOptions) {
  const analytics = google.analytics('v3');
  const jwtClient = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/analytics.readonly'],
    null
  );

  log('Authorising');

  return new Promise((resolve, reject) => {
    jwtClient.authorize(function(authErr /* tokens */) {
      if (authErr) {
        reject(authErr);
      }

      const query = Object.assign(
        {},
        {
          auth: jwtClient,
          ids: VIEW_ID,
          metrics: 'ga:uniquePageviews',
          dimensions: 'ga:pagePath',
          'start-date': globalArgv.start,
          'end-date': globalArgv.end,
          sort: '-ga:uniquePageviews',
          'max-results': 10000
        },
        queryOptions
      );

      console.log(
        `Fetching analytics data for ${query['start-date']}–${
          query['end-date']
        }`
      );

      analytics.data.ga.get(query, function(queryErr, analyticsResponse) {
        if (queryErr) {
          reject(queryErr);
        }

        resolve(analyticsResponse);
      });
    });
  });
}

function writeCsv(pages) {
  const csv = require('fast-csv');
  csv
    .writeToPath(
      'results.csv',
      pages.map(row => {
        return [row.cleanUrl, row.pageviews];
      })
    )
    .on('finish', function() {
      console.log('Results written to CSV');
    });
}
