const _ = require('lodash');
const cookie = require('cookie');

const parseCookie = cookieString => {
  return cookie.parse(cookieString);
}

const convert2Notion = (type, data, reverse = false) => {
  const converterMap = {
    checkbox: [
      data => ({ 'checkbox': !!data }),
    ],
    database_id: [
      data => ({'type': 'database_id', 'database_id': data}),
      data => _.get(data, 'database_id', '')
    ],
    date: [
      data => ({ 'date': { 'start': data }})
    ],
    file: [
      data => ({'files': [{'type': 'external', 'name': 'Cover', 'external': {'url': data}}]})
    ],
    icon: [
      data => ({'type': 'external', 'external': {'url': data}})
    ],
    multi_select: [
      data => ({'multi_select': data.map(i => ({'name': i }))})
    ],
    number: [
      data => ({'number': data})
    ],
    rich_text: [
      data => ({'rich_text': [{'type': 'text', 'text': {'content': data}}]}),
    ],
    select: [
      data => ({'select': {'name': data}})
    ],
    status: [
      data => ({"status": {"name": data}})
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

module.exports = {
  parseCookie,
  convert2Notion
}