const crypto = require('crypto');
const _ = require('lodash');
const axios = require('axios');
const { Client } = require('@notionhq/client');
const { parseCookie, convert2Notion, cleanMultiSelectOpts } = require('./helper');

const { DATABASE_ID, WEREAD_COOKIE } = process.env;

const WR_API_HOST = 'https://i.weread.qq.com';
const WEREAD_NOTEBOOKS_URL = 'https://i.weread.qq.com/user/notebooks';
const WEREAD_CHAPTER_INFO = 'https://i.weread.qq.com/book/chapterInfos';
const WEREAD_REVIEW_LIST_URL = 'https://i.weread.qq.com/review/list';
const WR_BOOK_LINK = 'https://weread.qq.com/web/reader/'
const WR_SHELF = '/shelf/sync';
const WR_BOOK_INFO = '/book/info';
const WR_READ_INFO = '/book/readinfo';
const WR_BOOKMARK_LIST = '/book/bookmarklist';

const NOTION_SOURCE_WR = '微信读书';
const MAX_PAGE_SIZE = 100;

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  logLevel: 'error'
});

const wrAxios = axios.create({
  baseURL: WR_API_HOST,
  headers: {
    'Content-Type': 'application/json',
    'Cookie': WEREAD_COOKIE
  },
  timeout: 0
});

const getShelfByVid = async (vid) => {
  const { data } = await wrAxios.get(WR_SHELF, { params: { vid }});
  return data;
}

const getBookInfo = async (bookId) => {
  const { data } = await wrAxios.get(WR_BOOK_INFO, { params: { bookId }});
  return data;
}

const getReadInfo = async (bookId) => {
  const { data } = await wrAxios.get(WR_READ_INFO, {
    params: {
      bookId,
      readingDetail: 1,
      readingBookIndex: 1,
      finishedDate: 1
    }
  });
  return data;
}

const getChapterBookmark = async (bookId, lastSynced) => {
  const { data: { updated = [], chapters = [] } } = await wrAxios.get(WR_BOOKMARK_LIST, {
    params: {
      bookId
    }
  });
  const chapterMap = chapters.reduce((map, { chapterUid, title }) => {
    map[chapterUid] = { chapterUid, chapterTitle: title, bookmarks: [] };
    return map;
  }, {});
  updated.sort((a, b) => a.createTime - b.createTime).filter(i => !lastSynced || i.createTime > lastSynced);
  updated.forEach(({ markText, chapterUid }) => {
    // markText:"[插图]" 对应的chapter不返回
    if (chapterMap[chapterUid]) {
      chapterMap[chapterUid].bookmarks.push(markText.trim());
    }
  });
  return {
    bookmarkList: Object.values(chapterMap).filter(i => i.bookmarks.length).sort((a, b) => a.chapterIdx - b.chapterIdx),
    lastSynced: _.get(updated, `${updated.length-1}.createTime`)
  }
}

const transformId = (bookId) => {
  const idLength = bookId.length;
  if (/^\d*$/.test(bookId)) {
    const ary = [];
    for (let i = 0; i < idLength; i += 9) {
      ary.push((parseInt(bookId.slice(i, i + 9), 10)).toString(16));
    }
    return { code: '3', transformedIds: ary };
  }
  let result = '';
  for (let i = 0; i < idLength; i++) {
    result += (bookId.charCodeAt(i)).toString(16);
  }
  return { code: '4', transformedIds: [result] };
}

const getEncryptedBookId = (bookId) => {
  const md5 = crypto.createHash('md5');
  md5.update(bookId, 'utf-8');
  const digest = md5.digest('hex');
  let result = digest.substring(0, 3);
  const { code, transformedIds } = transformId(bookId);
  result += code + '2' + digest.slice(-2);
  for (let i = 0; i < transformedIds.length; i++) {
    const hexLengthStr = (transformedIds[i].length).toString(16).padStart(2, '0');
    result += hexLengthStr + transformedIds[i];
    if (i < transformedIds.length - 1) {
      result += 'g';
    }
  }
  if (result.length < 20) {
    result += digest.substring(0, 20 - result.length);
  }
  const md5Second = crypto.createHash('md5');
  md5Second.update(result, 'utf-8');
  result += md5Second.digest('hex').substring(0, 3);
  return result;
}

const getBooks2Sync = ({ bookProgress = [], archive = [], books =[] }) => {
  const archiveMap = archive.reduce((map, { name, bookIds = [] }) => {
    bookIds.forEach(id => { map[id] = name; });
    return map;
  }, {});
  const progessMap = bookProgress.reduce((map, { bookId, progress }) => {
    map[bookId] = progress;
    return map;
  }, {});
  return books.reduce((map, { bookId, ...rest }) => {
    const archiveName = archiveMap[bookId] || '';
    if (archiveName !== 'Others') {
      map[bookId] = {
        ...rest,
        archiveName,
        progress: progessMap[bookId] || 0
      };
    }
    return map;
  }, {});
}

const insertTableOfContent = async (pageId) => {
  const { results } = await notion.blocks.children.append({
    block_id: pageId,
    children: [convert2Notion('table_of_contents')]
  });
  return results;
}

const insertChapTemp = async (pageId, chapTitle) => {
  const { results } = await notion.blocks.children.append({
    block_id: pageId,
    children: [
      convert2Notion('heading_1', chapTitle),
      convert2Notion('column_list', [
        convert2Notion('column', []),
        convert2Notion('column', [])
      ]),
      convert2Notion('callout', {
        content: '',
        icon: '🌟',
        color: 'yellow_background'
      })
    ]
  });
  return results;
}

const safeInsertChildren = async (blockId, children = []) => {
  // notion API 限制最多一次只能插入100条
  for (let i = 0; i < children.length; i += MAX_PAGE_SIZE) {
    await notion.blocks.children.append({
      block_id: blockId,
      children: children.slice(i, i + MAX_PAGE_SIZE)
    });
  }
}

(async () => {
  const { wr_vid: wrVid } = parseCookie(WEREAD_COOKIE);
  const books = getBooks2Sync(await getShelfByVid(wrVid));
  for (const bookId in books) {
    try {
      const book = books[bookId];
      const { archiveName, progress } = book;
      const cover = book.cover.replace(/\/s_([^\/]+)$/, '/t9_$1');
      const status = archiveName == 'Later' ? 'Backlog' : archiveName == 'Dropped' ? 'Dropped' : progress > 3 ? 'In progress' : 'Scheduled';
      const categories = book.categories ? _.uniq(book.categories.map(i => i.title).reduce((list, i) => {
        return list.concat(i.split('-'));
      }, [])) : [];

      const { intro = '', isbn, newRating = 0, authorSeg = [] } = await getBookInfo(bookId);
      const authors = authorSeg.filter(i => !!i.authorId).map(i => _.get(i, 'words', '').replace(/^\[.*?\]\s*/, '').trim());
      const { finishedDate } = await getReadInfo(bookId);
      const { results } = await notion.databases.query({
        database_id: DATABASE_ID,
        filter: {
          property: 'UID',
          rich_text: {
            equals: bookId
          }
        }
      });
      let doc = _.get(results, '0', null);
      if (_.get(doc, 'properties.Locked.checkbox') == true) {
        console.log(`skipped skip <${book.title}> as locked`);
        continue;
      }
      console.log(`syncing <${book.title}> ...`);
      let pageId = _.get(doc, 'id');
      const props = {
        'Progress': convert2Notion('number', progress),
        'Status': convert2Notion('status', status),
        'Source': convert2Notion('multi_select', [NOTION_SOURCE_WR]),
      };
      if (archiveName == 'Done' || progress == 100) {
        props['Status'] = convert2Notion('status', 'Done');
        props['Locked'] = convert2Notion('checkbox', true);
        props['Progress'] = convert2Notion('number', 100);
        if (finishedDate) {
          props['Completed'] = convert2Notion('date', new Date(finishedDate * 1000).toISOString());
        }
      }
      // sync book info and progress
      if (pageId) {
        await notion.pages.update({
          page_id: pageId,
          properties: props
        });
      } else {
        doc = await notion.pages.create({
          parent: convert2Notion('database_id', DATABASE_ID),
          icon: convert2Notion('icon', cover),
          properties: {
            ...props,
            'UID': convert2Notion('rich_text', bookId),
            'Name': convert2Notion('title', book.title),
            'Authors': convert2Notion('multi_select', authors),
            'Categories': convert2Notion('multi_select', categories),
            'Cover': convert2Notion('file', cover),
            'Type': convert2Notion('select', 'Book'),
            'Rating': convert2Notion('number', newRating / 100),
            'Intro': convert2Notion('rich_text', intro),
            'Link': convert2Notion('url', `${WR_BOOK_LINK}${getEncryptedBookId(bookId)}`),
          }
        });
        pageId = doc.id;
      }
      // sync notes
      const needSyncNotes = archiveName !== 'Dropped' && progress > 0;
      if (!needSyncNotes) { continue; }
      const lastSynced = convert2Notion('number', doc.properties.LastSynced, true);
      const blocks = [];
      let blockCursor;
      let blockFlag = true;
      while (blockFlag) {
        const { results, next_cursor, has_more } = await notion.blocks.children.list({
          block_id: pageId,
          start_cursor: blockCursor,
          page_size: MAX_PAGE_SIZE
        });
        if (!has_more || !results.length) {
          blockFlag = false;
        }
        blockCursor = next_cursor;
        blocks.push(...results);
      }
      const blockTOC = blocks.filter(i => i.type === 'table_of_contents');
      if (!blockTOC.length) {
        await insertTableOfContent(pageId);
      }
      const lastChapIdx = _.findLastIndex(blocks, i => i.type === 'heading_1');
      const chapTitles = blocks.filter(i => i.type === 'heading_1').map(i => convert2Notion('heading_1', i, true));
      const lastChapTitle = chapTitles[chapTitles.length - 1];
      const { bookmarkList, lastSynced: newLastSynced } = await getChapterBookmark(bookId, lastSynced);
      for (const { chapterTitle, bookmarks } of bookmarkList) {
        let chapNotesColumnId = '';
        if (chapTitles.includes(chapterTitle)) {
          if (lastChapTitle !== chapterTitle) { continue; }
          chapNotesColumnId = blocks[lastChapIdx + 1].id;
        } else {
          // insert chap template
          chapNotesColumnId = (await insertChapTemp(pageId, chapterTitle))[1].id;
        }
        const chapNotesId = _.get(await notion.blocks.children.list({
          block_id: chapNotesColumnId
        }), 'results.0.id');
        await safeInsertChildren(chapNotesId, bookmarks.map(i => convert2Notion('bulleted_list_item', i)));
      };
      newLastSynced && await notion.pages.update({
        page_id: pageId,
        properties: {
          'LastSynced': convert2Notion('number', newLastSynced)
        }
      });
    } catch (e) {
      console.log(`sync <${bookId}> ${e.stack}`);
    }
  }
})();