#!/usr/bin/env bash
# PHPStan with Larastan, installed apart from the app in api/tools/phpstan.
source "$(dirname "$0")/_common.sh"
cd "$ROOT/api"
[ -x tools/phpstan/vendor/bin/phpstan ] || (cd tools/phpstan && composer install --no-interaction)
php -d memory_limit=1G -d auto_prepend_file=tools/phpstan/vendor/autoload.php tools/phpstan/vendor/bin/phpstan analyse --no-progress --error-format=table | tee "$OUT/larastan.txt"
