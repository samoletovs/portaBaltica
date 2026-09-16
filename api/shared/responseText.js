'use strict';

const { StringDecoder } = require('node:string_decoder');

// A network chunk can end inside a UTF-8 code point. Keep one decoder per
// response instead of coercing each Buffer independently into a string.
function readResponseText(response) {
  return new Promise(function (resolve, reject) {
    const decoder = new StringDecoder('utf8');
    let text = '';
    response.on('data', function (chunk) {
      text += decoder.write(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    });
    response.on('end', function () { resolve(text + decoder.end()); });
    response.on('error', reject);
  });
}

module.exports = { readResponseText };
