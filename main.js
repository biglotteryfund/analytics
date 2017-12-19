// See: http://2ality.com/2015/10/google-analytics-api.html
require('dotenv').config();
const {head, orderBy, differenceWith, isEqual} = require('lodash');
const credentials = require('./credentials.json');
const google = require('googleapis');
const analytics = google.analytics('v3');
const VIEW_ID = process.env.VIEW_ID;
const liveRoutes = require(`${process.env.APP_DIR}/config/cloudfront/live.json`);

function queryData(query) {
    return new Promise((resolve, reject) => {
        analytics.data.ga.get(query, function (err, response) {
            if (err) {
                reject(err);
            }
            resolve(response);
        });
    });
}

function analyse({queryRows, totalPageViews}) {
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

    let livePaths = liveRoutes.map(_ => _.PathPattern);
    let targetPaths = urlsToTarget.map(_ => _.cleanUrl);
    let urlsToReplace = differenceWith(targetPaths, livePaths, isEqual);

    console.log(`Here are the pages we have yet to replace, which will get us to ${targetPercentage}%:\n`);

    let replacedTotal = 0;
    urlsToTarget.filter(row => {
        let alreadyReplaced = livePaths.indexOf(row.cleanUrl.toLowerCase()) !== -1;
        if (alreadyReplaced) {
            replacedTotal += row.pageviews;
        }
        return !alreadyReplaced;
    }).map((row, i) => {
        const urlPath = row.cleanUrl.replace('www.biglotteryfund.org.uk', '');
        console.log(`\t${i + 1}. ${urlPath} (${row.pageviews} pageviews)`)
    });

    let replacedPercentage = Math.round((replacedTotal / totalPageViews) * 100);

    console.log(`
    - There are ${orderedFinalScores.length} unique URLs accessed in this period.
    - This covers ${totalPageViews} total pageviews.
    - If we want to reach ${targetPercentage}% of pageviews, we need to replace ${urlsToReplace.length} pages.
    - We have already replaced ${(urlsToTarget.length - urlsToReplace.length)} pages, which gets us to ${replacedPercentage}% already.
  `);

}

const jwtClient = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/analytics.readonly'],
    null
);

jwtClient.authorize(function (err, tokens) {
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
        filters: 'ga:pagePath!@.pdf',
        'max-results': 10000
    }).then(data => {
        analyse({
            queryRows: data.rows,
            totalPageViews: parseInt(data.totalsForAllResults['ga:uniquePageviews'], 10),
        })
    }).catch(err => console.log(err));
});
