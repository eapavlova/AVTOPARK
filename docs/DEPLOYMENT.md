# Развертывание Autopark на сервере

Эта инструкция предназначена для постоянного Ubuntu-сервера с Docker Compose. До появления домена и реквизитов Bitrix24 команды служат подготовленным сценарием и не подтверждают фактическое развертывание.

## 1. Подготовка

На сервере должны быть установлены Docker Engine, Compose plugin, Git и HTTPS-прокси, например Caddy. В межсетевом экране открываются только SSH, HTTP и HTTPS. PostgreSQL из `docker-compose.production.yml` не публикует порт на хосте.

```bash
git clone <адрес-репозитория> autopark
cd autopark
cp .env.production.example .env.production
chmod 600 .env.production
```

В `.env.production` нужно заменить все демонстрационные значения. `APP_BASE_URL` указывает постоянный HTTPS-адрес без завершающего `/`. Пароль PostgreSQL в `DATABASE_URL` должен быть закодирован для URL и совпадать с `POSTGRES_PASSWORD`. Ключ `BITRIX_TOKEN_ENCRYPTION_KEY` должен быть независимой случайной строкой не короче 32 символов.

Проверка обязательных переменных и итоговой конфигурации:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml config
```

## 2. Первый запуск

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl --fail http://127.0.0.1:3000/api/ready
```

Ожидаемый ответ проверки готовности: `{"status":"ready"}`. Маршрут проверяет не только HTTP-процесс, но и чтение основного хранилища.

Пример минимальной конфигурации Caddy:

```caddyfile
autopark.example.ru {
    reverse_proxy 127.0.0.1:3000
}
```

После выпуска HTTPS-сертификата постоянный адрес используется для основного и установочного обработчиков Bitrix24, описанных в `LOCAL_BITRIX_SETUP.md`.

## 3. Постоянные данные

Приложение использует два именованных тома:

- `autopark_postgres_data` — основная база PostgreSQL, включая зашифрованные OAuth-данные Bitrix24;
- `autopark_files` — вложения путевых листов;

Удаление томов командой `docker compose down --volumes` приводит к потере данных и в рабочей эксплуатации не применяется.

## 4. Резервное копирование

Сценарий временно останавливает приложение, чтобы дамп базы, вложения и OAuth-данные относились к одному состоянию, но оставляет PostgreSQL работающим:

```bash
chmod +x scripts/backup-production.sh
ENV_FILE=.env.production ./scripts/backup-production.sh
```

Результат создается в `backups/<время UTC>/` и содержит `postgres.dump`, каталог `files` и контрольные суммы `SHA256SUMS`. Зашифрованные OAuth-данные входят в дамп PostgreSQL. Каталог резервных копий исключен из Git. Копии следует дополнительно отправлять в отдельное зашифрованное хранилище и регулярно проверять пробным восстановлением.

## 5. Восстановление

Восстановление заменяет рабочие данные. Перед ним обязательно создается свежая копия текущего состояния и проверяется выбранный архив:

```bash
cd backups/20260826T120000Z
sha256sum --check SHA256SUMS
cd ../..
docker compose --env-file .env.production -f docker-compose.production.yml stop app
docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres \
  sh -c 'pg_restore --clean --if-exists --no-owner --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  < backups/20260826T120000Z/postgres.dump
docker compose --env-file .env.production -f docker-compose.production.yml cp \
  backups/20260826T120000Z/files/. app:/app/data/files
docker compose --env-file .env.production -f docker-compose.production.yml start app
curl --fail http://127.0.0.1:3000/api/ready
```

После восстановления проверяются вход из Bitrix24, карточки автомобилей, последние путевые листы, скачивание вложения и состояние очередей уведомлений.

## 6. Обновление

Перед обновлением создается резервная копия. Затем исходный код обновляется и контейнер приложения пересобирается; миграции выполняются автоматически при подключении к PostgreSQL.

```bash
ENV_FILE=.env.production ./scripts/backup-production.sh
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl --fail http://127.0.0.1:3000/api/ready
```
