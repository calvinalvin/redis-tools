/*
** Atomic migration of redis keys based on pattern match from one instance to another
** This is not an ideal solution. You should use the built in redis MIGRATE command if possible
** redis MIGRATE: http://redis.io/commands/migrate
** 
** Use this if:
** - redis MIGRATE is not an option because you need to authorize against the target redis instance
** - using BGSAVE and then restoring from the dumped .rdb file is not an option
** - you only want to copy over certain keys based on a pattern match
** 
** Tips:
** - Since these are atomic operations, the migrations are slow and bound by network latency.
** - Most of the time is sucked up on network round-trip operations
** - In order to speed up transfers, you can fire up multiple instances of this program and give each instance different patterns
*/

var sys = require('sys')
  , redis = require('redis')
  , deferred = require('deferred');


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
  "*pattern*"
];
 
var source = redis.createClient(sourceOpts.port, sourceOpts.hostname);
var target = redis.createClient(targetOpts.port, targetOpts.hostname);
 
if (sourceOpts.auth) source.auth(sourceOpts.auth);
if (targetOpts.auth) target.auth(targetOpts.auth);
 
console.log("starting keys migration "+(new Date()));

source.on("error", function (err) {
    console.log("Error " + err);
});
 
target.on("error", function (err) {
    console.log("Error " + err);
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

  source.ttl(key, function (err, reply) {
    if (err) return def.reject(err);
    return def.resolve(reply);
  });

  return def.promise;
}

function promise_setTarget(type, key, val, ttl) {
  var def = deferred();

  if (type == 'hash') {
    console.log('migrating object');
    console.log(key);
    console.log(val);
    console.log(ttl);

    target.HMSET(key, val, ttl, function (err, reply) {
      if (err) return def.reject(err);
      return def.resolve(reply);
    });
  }
  else if (type == 'string'){
    console.log('migrating string');
    console.log(key);
    console.log(val);
    console.log(ttl);

    target.SETEX(key, ttl, val, function (err, reply) {
      if (err) return def.reject(err);
      return def.resolve(reply);
    });
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
  
  console.log('migrating: ' + key);

  var val = null;
  var ttl = null;
  var type = null;

  promise_getTypeFromSource(key)
    .then(function (typeFromSource) {
      type = typeFromSource;
      return promise_getTTLFromSource(key);
    })
    .then(function (ttlFromSource) {
      ttl = ttlFromSource;
      return promise_getValFromSource(key, type);
    })
    .then(function (valFromSource) {
      val = valFromSource;
      return promise_setTarget(type, key, val, ttl);
    })
    .then(function (success) {
      console.log(success);
      return migrate(callback);
    })
    .done();
}
 
function migrateKeys(patternsArray) {
    if (patternsArray.length == 0) process.exit();
 
    pattern = patternsArray.pop();
 
    console.log("going to migrate: " + pattern);
 
    source.keys(pattern, function (err, keys) {
        if (err) return console.log("error: "+err);
        else console.log('keys found: '+keys.length);
 
        g_keys = keys;
        g_last_n = keys.length;
 
        migrate(function(){
            migrateKeys(patternsArray);
        });
    });
}
 
// begin
migrateKeys(patterns);
