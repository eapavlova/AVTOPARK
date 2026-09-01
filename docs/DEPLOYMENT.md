# Развертывание Autopark без Docker

## Компоненты

На сервере нужны Node.js 20.6+, PostgreSQL 16+ (локально на сервере либо отдельный управляемый экземпляр), HTTPS-прокси и служебный пользователь `autopark`. Приложение и PostgreSQL запускаются как обычные службы ОС; Docker не нужен.

База хранит все рабочие данные. Каталог `FILE_STORAGE_DIR` содержит только вложения: в базе остаются метаданные и непрозрачный ключ. Для полноценного восстановления нужны дамп БД и каталог файлов.

## Структура базы

Миграции в `migrations/` — единственный источник схемы. Таблица `schema_migrations` фиксирует примененные изменения.

| Область | Таблицы | Назначение |
| --- | --- | --- |
| Справочники | `users`, `vehicles` | Сотрудники, роли, автомобили и текущие показатели. |
| Эксплуатация | `assignments`, `vehicle_transfers`, `waybills`, `waybill_revisions` | Закрепления, передачи, путевые листы и снимки исправлений. |
| Вложения | `waybill_files`, `transfer_files` | Метаданные файлов; содержимое расположено в защищенном каталоге. |
| Интеграция | `bitrix_installations`, `notification_outbox`, `vehicle_sync_outbox` | Зашифрованные токены и надежные очереди Bitrix24. |
| Контроль | `audit_log`, `app_metadata`, `app_counters` | Аудит, служебные даты и выдача идентификаторов. |

Внешние ключи не позволяют удалить связанные данные. Частичные уникальные индексы запрещают два активных закрепления или две незавершенные передачи одного автомобиля. Триггер запрещает обычному водителю иметь более одного активного автомобиля. `jsonb` применяется только к снимкам аудита и акту передачи — это тип PostgreSQL, не JSON-файлы.

## Первый запуск на Ubuntu

```bash
sudo apt update
sudo apt install -y postgresql postgresql-client nginx
sudo -u postgres psql -c "CREATE ROLE autopark LOGIN PASSWORD 'задайте-надежный-пароль';"
sudo -u postgres createdb --owner=autopark autopark
sudo adduser --system --group --home /opt/autopark autopark
sudo install -d -o autopark -g autopark /opt/autopark /var/lib/autopark/files /etc/autopark
```

Скопируйте исходный код в `/opt/autopark`, выполните `npm ci`, скопируйте `.env.production.example` в `/etc/autopark/autopark.env` и заполните секреты. Укажите `FILE_STORAGE_DIR=/var/lib/autopark/files`, затем ограничьте доступ к файлу окружения:

```bash
sudo chown root:autopark /etc/autopark/autopark.env
sudo chmod 640 /etc/autopark/autopark.env
cd /opt/autopark
sudo -u autopark env $(sudo cat /etc/autopark/autopark.env | xargs) npm run db:migrate
sudo cp deploy/autopark.service /etc/systemd/system/autopark.service
sudo systemctl daemon-reload
sudo systemctl enable --now autopark
curl --fail http://127.0.0.1:3000/api/ready
```

Настройте Nginx или Caddy как HTTPS-прокси к `127.0.0.1:3000`. Не открывайте PostgreSQL наружу. Для внешней управляемой БД укажите ее адрес в `DATABASE_URL` и `DATABASE_SSL=verify-full`.

## Резервное копирование и восстановление

```bash
set -a; . /etc/autopark/autopark.env; set +a
APP_SERVICE=autopark BACKUP_ROOT=/var/backups/autopark sh ./scripts/backup-postgres.sh
```

Если задан `APP_SERVICE`, скрипт кратко останавливает службу, чтобы дамп и файлы относились к одному состоянию, и запускает ее снова даже при ошибке. Он создает `postgres.dump`, копию вложений и `SHA256SUMS`. Готовые копии нужно отправлять в отдельное защищенное хранилище и регулярно проверять. Для восстановления остановите приложение, выполните `pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" /путь/postgres.dump`, верните содержимое `files` в `FILE_STORAGE_DIR`, затем запустите службу.

## Обновление

Создайте резервную копию, обновите код, выполните `npm ci`, затем `npm run db:migrate` с тем же файлом окружения и `sudo systemctl restart autopark`. Добавляйте изменения схемы только новыми миграциями; примененные файлы не редактируются.
