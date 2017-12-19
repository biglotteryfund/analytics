const _ = require('lodash');
const contentData = require('./content.json');

let finalScores = [];
let totalPageviews = 0;

const incrementScore = (url, pageviews) => {
    let findByUrl = url => finalScores.find(_ => _.url === url);
    let existingUrl = findByUrl(url);

    if (!existingUrl) {
        finalScores.push({
            url: url,
            pageviews: pageviews
        });
    } else {
        existingUrl.pageviews = existingUrl.pageviews + pageviews;
    }
}


contentData.forEach(c => {
    let url = c.Page.split('?');
    let u = url[0];
    let pageviews = parseInt(c['Page Views'].replace(/,/g, '')) || 0;
    totalPageviews += pageviews;
    incrementScore(u, pageviews);
});


finalScores = _.sortBy(finalScores, 'pageviews').reverse();


let targetPercentage = 80;
let pageviewsRequiredForTarget = totalPageviews / 100 * targetPercentage;

let count = 0;
let urlsToTarget = finalScores.filter(u => {
    count += u.pageviews;
    return count < pageviewsRequiredForTarget;
});


console.log(JSON.stringify(finalScores, null, 4));
console.log('There are ' + finalScores.length + ' unique URLs accessed in this period');
console.log('This covers ' + totalPageviews + ' total pageviews');
console.log('If we want to replace ' + targetPercentage + '% of these pages with new ones, we need to replace ' + urlsToTarget.length + ' of them');

urlsToTarget.map(_ => console.log(`${_.url} (${_.pageviews} pageviews)`));