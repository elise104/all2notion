const _ = require('lodash');
const axios = require('axios');
const cheerio = require('cheerio');
const { Client } = require('@notionhq/client');
const { convert2Notion } = require('./helper');

const { DATABASE_ID, DB_UID } = process.env;
const DB_MOVIE_LIST = (process.env.DB_MOVIE_LIST || '').split(',').map(i => i.trim());
const DB_BLOCK_LIST = (process.env.DB_BLOCK_LIST || '').split(',').map(i => i.trim());

const DB_MOVIE = 'https://movie.douban.com/subject/';
// const DB_DRAMA = `https://www.douban.com/location/drama/`;
const DB_MOVIE_TODO = `https://movie.douban.com/people/${DB_UID}/wish`;
const DB_MOVIE_DONE = `https://movie.douban.com/people/${DB_UID}/collect`;
// const DB_DRAMA_TODO = `https://www.douban.com/location/people/${DB_UID}/drama/wish`;
// const DB_DRAMA_DONE = `https://www.douban.com/location/people/${DB_UID}/drama/collect`;

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  logLevel: 'error'
});

const getHtml = async (url) => {
  const { data } = await axios.get(url);
  return data;
}

const getLinksFromHtml = (html) => {
  const pattern = new RegExp(`${DB_MOVIE}\\d+`, 'g');
  return _.uniq(html.match(pattern) || []);
}

const parseItemHtml = (id, htmlStr) => {
  const $ = cheerio.load(htmlStr);
  const schema = JSON.parse($('script[type="application/ld+json"]').html().replace(/[\x00-\x1F\x7F-\x9F]/g, ''));
  const subject = {
    uid: id,
    name: schema.name,
    cover: schema.image,
    categories: schema.genre,
    intro: schema.description,
    rating: Number(_.get(schema, 'aggregateRating.ratingValue', 0)) || 0,
    type: schema['@type'] === 'TVSeries' ? 'TV Series': 'Movie',
    // authors: _.get(schema, 'director', []).map(i => i.name),
    authors: $('meta[property="video:director"]').map((_, e) => $(e).attr('content')).get(),
    source: [],
    link: `${DB_MOVIE}${id}/`
  };
  const intro = $('#link-report-intra span[property="v:summary"]').text();
  if (intro && (intro.length > subject.intro.length)) {
    subject.intro = intro.replace(/\s+/g, ' ').trim();
  }
  const rawSources = $('div.gray_ad ul.bs li a').map((_, e) => $(e).text()).get();
  rawSources.length && (subject.source = rawSources.map(s => s.trim().replace(/视频|TV/,'')));
  return subject;
}

const syncItems = async (links, status = 'Backlog') => {
  for (const link of links) {
    const [, id] = link.match(/\/(\d+)/);
    if (DB_BLOCK_LIST.includes(id)) {
      continue;
    }
    try {
      const item = parseItemHtml(id, await getHtml(link));
      const { results } = await notion.databases.query({
        database_id: DATABASE_ID,
        filter: {
          property: 'UID',
          rich_text: {
            equals: id
          }
        }
      });
      if (_.get(results, '0.properties.Locked.checkbox') == true) {
        console.log(`skipped skip <${item.name}> as locked`);
        continue;
      }
      console.log(`syncing <${item.name}> ...`);
      const pageId = _.get(results, '0.id');
      const props = {
        "Source": convert2Notion('multi_select', item.source),
        "Rating": convert2Notion('number', item.rating),
      }
      if (status == 'Done') {
        // 每天同步，近似认为变成Done的时间为同步时间
        props["Completed"] = convert2Notion('date', new Date().toISOString());
        props["Status"] = convert2Notion('status', status);
        props["Locked"] = convert2Notion('checkbox', true);
      }
      if (pageId) {
        await notion.pages.update({
          page_id: pageId,
          properties: props
        });
      } else {
        await notion.pages.create({
          parent: convert2Notion('database_id', DATABASE_ID),
          icon: convert2Notion('icon', item.cover),
          properties: {
            ...props,
            "Name": convert2Notion('title', item.name),
            "UID": convert2Notion('rich_text', item.uid),
            "Authors": convert2Notion('multi_select', item.authors),
            "Categories": convert2Notion('multi_select', item.categories),
            "Status": convert2Notion('status', status),
            "Cover": convert2Notion('file', item.cover),
            "Intro": convert2Notion('rich_text', item.intro),
            "Type": convert2Notion('select', item.type),
            "Link": convert2Notion('url', item.link),
          }
        });
      }
    } catch (e) {
      console.log(`sync <${id}> ${e.stack}`);
    }
  }
}

(async () => {
  const movieTodo = getLinksFromHtml(await getHtml(DB_MOVIE_TODO), 'MOVIE').concat(DB_MOVIE_LIST.map(i => `${DB_MOVIE}${i}`));
  const movieDone = getLinksFromHtml(await getHtml(DB_MOVIE_DONE), 'MOVIE');
  await syncItems(movieTodo);
  await syncItems(movieDone, 'Done');
  return;
})();