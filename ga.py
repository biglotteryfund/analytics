import os
import json
import googleanalytics as ga

if os.path.exists('credentials.json'):
    credentials = json.load(open('credentials.json'))
else:
    credentials = ga.authorize()
    credentials = credentials.serialize()
    json.dump(credentials, open('credentials.json', 'w'))

ga.authenticate(**credentials)

profile = ga.authenticate(
    save=True,
    interactive=True,
    identity='BLF Dev',
    account='Big Lottery Fund',
    webproperty='Biglotteryfund.org.uk'
)

pageviews = profile.core.query.metrics('pageviews').daily(months=-1).rows

top_pages = profile.core.query \
    .metrics('pageviews', 'unique pageviews', 'time on page', 'bounces', 'entrances', 'exits') \
    .dimensions('pagePath') \
    .daily(months=-1) \
    .sort('pageviews', descending=True)



json = top_pages.as_dataframe().to_json()

print(json)