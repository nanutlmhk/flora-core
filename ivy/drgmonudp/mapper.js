'use strict';

const fs   = require('fs');
const path = require('path');

const MAP_FILE = path.join(__dirname, 'map.json');

function load() {
  if (fs.existsSync(MAP_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function save(map) {
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2));
}

// Add or update a key mapping
// entry: { name, unit, confirmed }
function set(key, name, unit = '', confirmed = false) {
  const map = load();
  map[key] = { name, unit: unit || '', confirmed };
  save(map);
  return map[key];
}

function confirm(key) {
  const map = load();
  if (map[key]) {
    map[key].confirmed = true;
    save(map);
  }
}

function remove(key) {
  const map = load();
  delete map[key];
  save(map);
}

// Translate a raw byte key to human name, or return the key itself
function name(key, map) {
  const entry = (map || load())[key];
  return entry ? entry.name : null;
}

function unit(key, map) {
  const entry = (map || load())[key];
  return entry ? entry.unit : '';
}

module.exports = { load, save, set, confirm, remove, name, unit };
