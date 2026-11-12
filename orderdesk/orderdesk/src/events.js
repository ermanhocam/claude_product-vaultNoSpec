'use strict';

const { EventEmitter } = require('events');

const bus = new EventEmitter();
const history = [];

function emit(name, payload) {
  history.push({ name, payload });
  bus.emit(name, payload);
}

function on(name, handler) {
  bus.on(name, handler);
}

module.exports = { emit, on, history };
