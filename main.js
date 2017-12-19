// See: http://2ality.com/2015/10/google-analytics-api.html
require('dotenv').config();
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
    'start-date': '30daysAgo',
    'end-date': 'yesterday',
    sort: '-ga:uniquePageviews'
    // filters: 'ga:pagePath!@.pdf'
  }).then(data => {
    console.log(JSON.stringify(data, null, 4));
  }).catch(err => console.log(err));
});
