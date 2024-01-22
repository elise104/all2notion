const _ = require('lodash');
const cookie = require('cookie');

const parseCookie = cookieString => {
  return cookie.parse(cookieString);
}

const convert2Notion = (type, data, reverse = false) => {
  const converterMap = {
    bulleted_list_item: [
      data => ({ 'bulleted_list_item': convert2Notion('rich_text', data)})
    ],
    callout: [
      ({ content, icon, color }) => ({
        'type': 'callout',
        'callout': {
          'rich_text': [{ 'type': 'text', 'text': { 'content': content }}],
          'icon': { 'emoji': icon },
          'color': color
        },
      }),
    ],
    checkbox: [
      data => ({ 'checkbox': !!data }),
    ],
    column: [
      data => ({ 'column': { 'children': data }}),
    ],
    column_list: [
      data => ({
        'type': 'column_list',
        'column_list': {
          'children': data
      } }),
    ],
    database_id: [
      data => ({'type': 'database_id', 'database_id': data}),
      data => _.get(data, 'database_id', '')
    ],
    date: [
      data => ({ 'date': { 'start': data }})
    ],
    divider: [
      _ => ({ 'type': 'divider', 'divider': {}})
    ],
    file: [
      data => ({'files': [{'type': 'external', 'name': 'Cover', 'external': {'url': data}}]})
    ],
    heading_1: [
      data => ({
        'type': 'heading_1',
        'heading_1': {
          'rich_text': [{ type: 'text', text: {'content': data }}]
        },
      }),
      data => _.get(data, 'heading_1.rich_text.0.text.content')
    ],
    icon: [
      data => ({'type': 'external', 'external': {'url': data}})
    ],
    multi_select: [
      data => ({'multi_select': data.map(i => ({'name': i }))})
    ],
    number: [
      data => ({'number': data}),
      data => _.get(data, 'number', 0)
    ],
    rich_text: [
      data => ({'rich_text': [{'type': 'text', 'text': {'content': data}}]}),
    ],
    select: [
      data => ({'select': {'name': data}})
    ],
    status: [
      data => ({'status': {'name': data}})
    ],
    table_of_contents: [
      _ => ({'table_of_contents': {'color': 'default'}}),
    ],
    title: [
      data => ({'title': [{'type': 'text', 'text': {'content': data }}]}),
    ],
    url: [
      data => ({'url': data})
    ],
  }
  return converterMap[type][+reverse](data);
}

const cleanMultiSelectOpts = async (client, database_id, prop) => {
  const items = await client.databases.query({ database_id });
  const validOpts = _.uniqBy(items.results.map(i => _.get(i, `properties.${prop}.multi_select`, [])).reduce((p, c) => {
    return p.concat(c);
  }, []), 'id');
  await client.databases.update({
    database_id,
    properties: {
      [prop]: {
        type: 'multi_select',
        multi_select: { options: validOpts }
      }
    }
  });
}

module.exports = {
  parseCookie,
  convert2Notion,
  cleanMultiSelectOpts
}