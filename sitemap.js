#!/usr/bin/env node
const csv = require('csvtojson');
const _ = require('lodash');

// via https://stackoverflow.com/questions/45075261/flat-directory-path-to-heirarchy
function convertToHierarchy(paths) {
    // Build the node structure
    const rootNode = {
        name: "root",
        children: []
    };

    paths.forEach(path => buildNodeRecursive(rootNode, path, 0));

    return rootNode;
}

function buildNodeRecursive(node, pathItem, idx) {
    let path = pathItem.url.split('/');
    if (idx < path.length) {
        let item = path[idx];
        let dir = node.children.find(child => child.name === item);
        if (!dir) {
            node.children.push(dir = {
                name: item,
                pageviews: pathItem.pageviews,
                children: []
            });
        }
        buildNodeRecursive(dir, pathItem, idx + 1);
    }
}

csv({
    noheader: true,
    headers: ['url', 'pageviews'],
    colParser: {
        pageviews: 'number'
    }
})
    .fromFile('./results.csv')
    .on('end_parsed', jsonArrObj => {
        let list = jsonArrObj.map(i => {
            let clean = i.url.replace('https://www.biglotteryfund.org.uk/', '');

            // remove anything after a question mark
            let bits = clean.split('?');
            if (bits.length >= 1) {
                clean = bits[0];
            }

            // remove anything after a hash
            bits = clean.split('#');
            if (bits.length >= 1) {
                clean = bits[0];
            }

            return {
                url: clean,
                pageviews: i.pageviews
            };
        });
        list = _.sortBy(_.uniqBy(list, 'url'), '-pageviews');
        console.log(JSON.stringify(convertToHierarchy(list), null, 4));
    })
    .on('done', error => {
        console.log('end', error)
    });