# Redis Tools

Miscellaneous redis tools written in Nodejs



## atomic-migrate-key-patterns.js

Atomic migration of redis keys based on pattern match from one instance to another. This is not an ideal solution. You should use the built in redis MIGRATE command if possible. see redis MIGRATE: http://redis.io/commands/migrate


#### Use this if:
 - redis MIGRATE is not an option because you need to authorize against the target redis instance
 - using BGSAVE and then restoring from the dumped .rdb file is not an option
 - you only want to copy over certain keys based on a pattern match

#### Tips:
 - Since these are atomic operations, the migrations are slow and bound by network latency.
 - Most of the time is sucked up on network round-trip operations
 - In order to speed up transfers, you can fire up multiple instances of this program and give each instance different patterns
 - Use the pattern '*' to migrate all keys

``` Currently there is no option to automatically delete keys after they have been migrated. This is by design to prevent accidental deletion of keys. ```
 - You can delete keys manually by use the atomic-delete-key-patterns.js program to delete all keys matching a pattern
