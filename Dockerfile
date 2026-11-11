# Voyager Trip Manager — one container: nginx (PWA + headers) + PHP-FPM (Laravel API).
# Built in CI, scanned with Trivy, pushed to ECR, run on ECS Fargate (docs/MIGRATION-PLAN.md §2).
# TODO(owner): swap the base images for the organisation's approved/hardened images if required.

FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/ ./
RUN npm run build:aws

FROM composer:2 AS vendor
WORKDIR /src/api
COPY api/composer.json api/composer.lock ./
RUN composer install --no-dev --no-interaction --no-scripts --prefer-dist --optimize-autoloader --ignore-platform-req=ext-gmp

FROM php:8.3-fpm-alpine
RUN apk add --no-cache nginx supervisor postgresql-libs gmp \
 && apk add --no-cache --virtual .build postgresql-dev gmp-dev $PHPIZE_DEPS \
 && docker-php-ext-install pdo_pgsql gmp bcmath opcache \
 && apk del .build
COPY deploy/php.ini /usr/local/etc/php/conf.d/zz-voyager.ini
COPY deploy/nginx.conf /etc/nginx/http.d/default.conf
COPY deploy/supervisord.conf /etc/supervisord.conf
COPY --from=web /src/web/dist-aws /srv/web
COPY api/ /srv/api
COPY --from=vendor /src/api/vendor /srv/api/vendor
RUN rm -rf /srv/api/tests /srv/api/tools /srv/api/.env* /srv/api/phpunit.xml \
 && chown -R www-data:www-data /srv/api/storage /srv/api/bootstrap/cache \
 && sed -i 's/^listen = .*/listen = 127.0.0.1:9000/' /usr/local/etc/php-fpm.d/zz-docker.conf
WORKDIR /srv/api
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/up >/dev/null || exit 1
# Config comes from the environment / Secrets Manager at run time (nothing secret is baked in).
CMD ["sh", "-c", "php artisan config:cache && php artisan route:cache && exec supervisord -c /etc/supervisord.conf"]
