/*
** Atomic migration of redis keys based on pattern match from one instance to another
** This is not an ideal solution. You should use the built in redis MIGRATE command if possible
** redis MIGRATE: http://redis.io/commands/migrate
** 
** Use this if:
** - redis MIGRATE is not an option because you need to authorize against the target redis instance
** - if the source redis instance cannot reach the target redis instance, you can use this app by running it from the target instance
** - using BGSAVE and then restoring from the dumped .rdb file is not an option
** - you only want to copy over certain keys based on a pattern match
** 
** Tips:
** - Since these are atomic operations, the migrations are slow and bound by network latency.
** - Most of the time is sucked up on network round-trip operations
** - In order to speed up transfers, you can fire up multiple instances of this program and give each instance different patterns
** - Use the pattern '*' to migrate all keys
** 
** Currently there is no option to automatically delete keys after they have been migrated. This is as a fail safe measure.
** You can delete keys manually by use the atomic-delete-key-patterns.js program to delete all keys matching a pattern

  Copyright (c) 2013 Calvin Alvin https://github.com/calvinalvin

  The MIT License (MIT)

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  THE SOFTWARE.
*/


var sys = require('sys')
  , redis = require('redis')
  , async = require('async')
  , deferred = require('deferred')
  , colors = require('colors');


var start = process.hrtime();

var sourceOpts = {
  hostname: 'source.host.com',
  port: 6379,
  // set auth: null if no authentication is required
  auth: null
};
 
var targetOpts = {
    hostname: 'target.host.com',
    port: 6379,
    // set auth: null if no authentication is required
    auth: null
};
 
// add here the patterns for the keys you want to migrate from a source instance to a target instance
var patterns = [
  "*"
];
 
var source = redis.createClient(sourceOpts.port, sourceOpts.hostname);
var target = redis.createClient(targetOpts.port, targetOpts.hostname);
 
if (sourceOpts.auth) source.auth(sourceOpts.auth);
if (targetOpts.auth) target.auth(targetOpts.auth);
 
console.log("starting keys migration "+(new Date()));

source.on("error", function (err) {
    console.log("Error ".red + err);
});
 
target.on("error", function (err) {
    console.log("Error ".red + err);
});

// stores all keys in memory during operation
var g_keys;
var g_last_n;
 

function promise_getValFromSource(key, type) {
  var def = deferred();

  if (type == 'string') {
    // it's s string key
    source.GET(key, function (err, reply) {
      if (err) return def.reject(err);
      return def.resolve(reply);
    });
  }
  else {
    // it's a hash key
    source.HGETALL(key, function (err, reply) {
      if (err) return def.reject(err);
      return def.resolve(reply);
    });
  }
  return def.promise;
}

function promise_getTypeFromSource(key) {
  var def = deferred();

  source.TYPE(key, function (err, reply) {
    if (err) return def.reject(err);
    return def.resolve(reply);
  });

  return def.promise;
}

function promise_getTTLFromSource(key) {
  var def = deferred();

  source.TTL(key, function (err, reply) {
    if (err) return def.reject(err);
    return def.resolve(reply);
  });

  return def.promise;
}

function promise_setTarget(type, key, val, ttl) {
  var def = deferred();

  if (type == 'hash') {
    console.log('migrating: '.cyan + key);
    console.log(type);
    console.log(val);
    console.log(ttl);

    target.HMSET(key, val, function (err, reply) {
      if (err) return def.reject(err);
      return def.resolve(reply);
    });
  }
  else if (type == 'string'){
    console.log('migrating: '.cyan + key);
    console.log(type);
    console.log(val);
    console.log(ttl);

    if (ttl) {
      target.SETEX(key, ttl, val, function (err, reply) {
        if (err) return def.reject(err);
        return def.resolve(reply);
      });
    }
    else {
      target.SET(key, val, function (err, reply) {
        if (err) return def.reject(err);
        return def.resolve(reply);
      });
    }
  } 

  return def.promise;
}

function migrate(callback) {
  if (g_keys.length == 0) return callback();  
 
  key = g_keys.pop();
  len = g_keys.length;
 
  if (g_last_n - len > 5000) {
    console.log(new Date()+" : "+len);
    g_last_n = len;
  }

  var type, val, ttl;

  promise_getTypeFromSource(key)
    .then(function (typeFromSource) {
      type = typeFromSource;

      async.parallel([
          function (cb){
             promise_getTTLFromSource(key)
              .then(function (ttlFromSource) {
                ttl = ttlFromSource;
                cb(null, ttlFromSource);
              })
              .done();
          },
          function (cb){
            promise_getValFromSource(key, typeFromSource)
              .then(function (valFromSource) {
                val = valFromSource;
                cb(null, valFromSource)
              })
              .done();
          }
      ],
      function (err, results) {
          if (err) {
            console.log(err);
            process.exit();
          }

          promise_setTarget(type, key, val, ttl)
            .then(function (success) {
              var elapsed = process.hrtime(start)[1] / 1000000; // divide by a million to get nano to milli
              console.log(success + ' took ' + elapsed + 'ms');
              return migrate(callback);
            })
            .done();
      });

    })
    .done();
}
 
function migrateKeys(patternsArray) {
    if (patternsArray.length == 0) process.exit();
 
    pattern = patternsArray.pop();
 
    console.log("going to migrate pattern matches for: ".cyan + pattern);
 
    source.KEYS(pattern, function (err, keys) {
        if (err) return console.log("error: "+err);
        else console.log('keys found: '.cyan +keys.length);
 
        g_keys = keys;
        g_last_n = keys.length;
 
        migrate(function(){
            migrateKeys(patternsArray);
        });
    });
}
 
// begin
migrateKeys(patterns);
