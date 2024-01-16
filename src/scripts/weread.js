const axios = require('axios');
const { Client } = require('@notionhq/client');
const { parseCookie } = require('./helper');

const WEREAD_URL = 'https://weread.qq.com/';
const WEREAD_NOTEBOOKS_URL = 'https://i.weread.qq.com/user/notebooks';
const WEREAD_BOOKMARKLIST_URL = 'https://i.weread.qq.com/book/bookmarklist';
const WEREAD_CHAPTER_INFO = 'https://i.weread.qq.com/book/chapterInfos';
const WEREAD_READ_INFO_URL = 'https://i.weread.qq.com/book/readinfo';
const WEREAD_REVIEW_LIST_URL = 'https://i.weread.qq.com/review/list';
const WEREAD_BOOK_INFO = 'https://i.weread.qq.com/book/info';
const WEREAD_SHELF = 'https://i.weread.qq.com/shelf/sync';

const NOTION_SOURCE_WR = '微信读书';

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  logLevel: 'error'
});

const wrAxios = axios.create({
  baseURL: 'https://i.weread.qq.com',
  headers: {
    'Content-Type': 'application/json'
  }
});
wrAxios.defaults.headers.common['Cookie'] = process.env.WEREAD_COOKIE;
wrAxios.defaults.timeout = 0;

const getShelfByVid = async (vid) => {
  const { data } = await wrAxios.get('/shelf/sync', { params: { vid }})
  return data;
}

const getBooks2Sync = ({ bookProgress, archive, books }) => {
  const bookMap = {};

  return bookMap;
}

(async () => {
  const {
    WEREAD_COOKIE: wrCookie,
    DATABASE_ID: databaseId
  } = process.env;
  const { wr_vid: wrVid } = parseCookie(wrCookie);
  const books = getBooks2Sync(await getShelfByVid(wrVid));
  console.log(books);

})();