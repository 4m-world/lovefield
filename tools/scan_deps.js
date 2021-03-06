/**
 * @license
 * Copyright 2014 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var pathMod = require('path');
var fsMod = require('fs');


/** @type {{CLOSURE_LIBRARY_PATH: string}} */
var config = /** @type {!Function} */ (
    require(pathMod.resolve(__dirname + '/config.js')))();



/**
 * @constructor @struct
 * @private
 */
var ProvideMap_ = function() {
  this.map_ = {};
  this.reverse_ = {};
};


/**
 * @param {string} ns
 * @param {string} path
 */
ProvideMap_.prototype.set = function(ns, path) {
  this.map_[ns] = path;
  if (!this.reverse_.hasOwnProperty(path)) {
    this.reverse_[path] = [];
  }
  this.reverse_[path].push(ns);
};


/**
 * @param {string} ns
 * @return {?string}
 */
ProvideMap_.prototype.get = function(ns) {
  return this.map_.hasOwnProperty(ns) ? this.map_[ns] : null;
};


/**
 * @return {!Object}
 */
ProvideMap_.prototype.getAllProvides = function() {
  return this.reverse_;
};



/**
 * @constructor @struct
 * @private
 */
var RequireMap_ = function() {
  this.map_ = {};
};


/**
 * @param {string} path
 * @param {string} ns
 */
RequireMap_.prototype.set = function(path, ns) {
  if (!this.map_.hasOwnProperty(path)) {
    this.map_[path] = {};
  }
  this.map_[path][ns] = true;
};


/**
 * @param {!Object} obj
 * @return {!Array.<string>}
 * @private
 */
RequireMap_.prototype.objectKeys_ = function(obj) {
  var results = [];
  for (var key in obj) {
    results.push(key);
  }
  return results;
};


/**
 * @param {string} path
 * @return {!Array.<string>}
 */
RequireMap_.prototype.get = function(path) {
  if (this.map_.hasOwnProperty(path)) {
    return this.objectKeys_(this.map_[path]);
  }
  return [];
};


/** @return {!Array.<string>} */
RequireMap_.prototype.getAllDependencies = function() {
  var results = {};
  for (var path in this.map_) {
    for (var key in this.map_[path]) {
      results[key] = true;
    }
  }

  return this.objectKeys_(results);
};


/** @return {!Object} */
RequireMap_.prototype.getAllRequires = function() {
  var results = {};
  for (var key in this.map_) {
    results[key] = [];
    for (var value in this.map_[key]) {
      results[key].push(value);
    }
  }
  return results;
};


/**
 * @param {string} dir
 * @param {!Array.<string>} files
 */
function getFiles(dir, files) {
  var candidates = fsMod.readdirSync(dir);
  for (var file in candidates) {
    if (!candidates.hasOwnProperty(file)) continue;
    var name = dir + '/' + candidates[file];
    if (fsMod.statSync(name).isDirectory()) {
      getFiles(name, files);
    } else if (pathMod.extname(name) == '.js') {
      files.push(name);
    }
  }
}


/**
 * @param {string} startPath
 * @return {!Array.<string>} relativePaths
 */
function relativeGlob(startPath) {
  var files = [];
  getFiles(startPath, files);
  return files;
}


/**
 * @param {!Array.<string>} filePaths
 * @param {!ProvideMap_} provideMap
 * @param {!RequireMap_} requireMap
 */
function scanFiles(filePaths, provideMap, requireMap) {
  /**
   * @param {string} line
   * @param {string} pattern
   * @return {?string} Extracted namespace or null.
   */
  var extractNamespace = function(line, pattern) {
    if (line.slice(0, pattern.length) == pattern) {
      return line.substring(pattern.length + 2, line.indexOf(';') - 2);
    }
    return null;
  };

  filePaths.forEach(function(path) {
    var realPath = pathMod.resolve(path);
    var contents = fsMod.readFileSync(realPath).toString().split('\n');
    contents.forEach(function(line) {
      var ns = extractNamespace(line, 'goog.require');
      if (ns) {
        requireMap.set(realPath, ns);
      }
      ns = extractNamespace(line, 'goog.provide');
      if (ns) {
        provideMap.set(ns, realPath);
      }
    });
  });
}


/**
 * @param {string} filePath
 * @return {string} requires
 */
function extractRequires(filePath) {
  var provideMap = new ProvideMap_();
  var requireMap = new RequireMap_();
  scanFiles([filePath], provideMap, requireMap);
  return requireMap.get(filePath).map(function(ns) {
    return '\'' + ns + '\'';
  }).join(', ');
}


/**
 * @param {!RequireMap_} codeRequire
 * @return {!Array.<string>} Associated Closure files
 */
function extractClosureDependencies(codeRequire) {
  var closureRequire = new RequireMap_();
  var closureProvider = new ProvideMap_();
  var closurePath = config.CLOSURE_LIBRARY_PATH + '/closure/goog';
  scanFiles(relativeGlob(closurePath), closureProvider, closureRequire);

  var closureDeps = codeRequire.getAllDependencies().filter(function(element) {
    return element.slice(0, 4) == 'goog';
  });

  var map = {};
  closureDeps.forEach(function(ns) {
    map[ns] = closureProvider.get(ns);
  });

  var countKeys = function(object) {
    var keys = [];
    for (var key in object) {
      keys.push(key);
    }
    return keys.length;
  };

  var oldCount;
  do {
    oldCount = countKeys(map);
    for (var key in map) {
      var requires = closureRequire.get(map[key]);
      requires.forEach(function(ns) {
        map[ns] = closureProvider.get(ns);
      });
    }
  } while (countKeys(map) != oldCount);

  var closureFiles = [];
  for (var key in map) {
    closureFiles.push(map[key]);
  }
  return closureFiles;
}


/**
 * Find Closure dependency files for the lib.
 * @return {!Array.<string>}
 */
function scanDeps() {
  var provideMap = new ProvideMap_();
  var requireMap = new RequireMap_();
  scanFiles(relativeGlob('lib'), provideMap, requireMap);
  return extractClosureDependencies(requireMap).concat(
      pathMod.resolve(
          pathMod.join(config.CLOSURE_LIBRARY_PATH, 'closure/goog/base.js')));
}


/**
 * Generates goog.addDependency.
 * @param {string} basePath
 * @param {!ProvideMap_} provideMap
 * @param {!RequireMap_} requireMap
 * @return {!Array.<string>}
 */
function genAddDependency(basePath, provideMap, requireMap) {
  var provide = provideMap.getAllProvides();
  var require = requireMap.getAllRequires();
  var set = {};

  for (var key in provide) {
    set[key] = true;
  }
  for (var key in require) {
    set[key] = true;
  }

  var results = [];
  for (var key in set) {
    var servePath = pathMod.relative(basePath, key);
    var line = 'goog.addDependency("../../' + servePath + '", ';

    if (provide.hasOwnProperty(key)) {
      line += JSON.stringify(provide[key]) + ', ';
    } else {
      line += '[], ';
    }

    if (require.hasOwnProperty(key)) {
      line += JSON.stringify(require[key]) + ');';
    } else {
      line += '[]);';
    }
    results.push(line);
  }
  return results;
}


/**
 * Generates deps.js used for testing.
 * @param {string} basePath
 * @param {!Array.<string>} targets
 * @return {string}
 */
function genDeps(basePath, targets) {
  var provideMap = new ProvideMap_();
  var requireMap = new RequireMap_();

  var files = [];
  targets.forEach(function(target) {
    files = files.concat(relativeGlob(target));
  });
  scanFiles(files, provideMap, requireMap);
  var closureFiles = extractClosureDependencies(requireMap);
  var closureProvide = new ProvideMap_();
  var closureRequire = new RequireMap_();
  scanFiles(closureFiles, closureProvide, closureRequire);

  var results = genAddDependency(basePath, provideMap, requireMap);
  return results.join('\n');
}


/** @type {Function} */
exports.scanDeps = scanDeps;


/** @type {Function} */
exports.genDeps = genDeps;


/** @type {Function} */
exports.extractRequires = extractRequires;
