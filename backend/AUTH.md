# Авторизация BookAITU и контракт для frontend

## Что реализовано

Вход состоит из двух обязательных этапов: Microsoft Entra университета и TOTP-код из приложения-аутентификатора. При первом входе пользователь подключает второй фактор через QR-код. BookAITU не принимает и не хранит пароль Microsoft. Парольной регистрации и обходного локального входа нет.

Microsoft-вход использует OpenID Connect Authorization Code + PKCE, `state` и `nonce`. `openid-client` проверяет issuer, audience, срок действия и подпись ID token через Microsoft JWKS. Затем приложение проверяет точный university tenant, `oid`, статус участника `acct=0` и точный разрешённый домен. Личные аккаунты, другие tenants, гости и токены без `acct` отклоняются. Identity хранится как `tenantId:objectId`; email используется для профиля и дополнительной проверки домена, а не как доказательство личности или источник роли.

Документация Microsoft: [Authorization Code + PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [проверка tenant и claims](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation), [optional claims и acct](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference).

## Настройка Microsoft Entra

Одного студенческого email недостаточно. Нужна регистрация приложения в tenant университета; если студентам она запрещена, это делает администратор университета. Не создавайте приложение в постороннем tenant и не подменяйте проверку tenant проверкой окончания email.

1. Entra ID → App registrations → New registration. Выбрать **Accounts in this organizational directory only**.
2. Authentication → Add a platform → **Web**. Callback обрабатывает Node.js, поэтому платформу SPA для него выбирать не нужно.
3. Зарегистрировать URI, точно совпадающий с `MICROSOFT_REDIRECT_URI`. Для текущего локального запуска это `http://localhost:3101/api/auth/microsoft/callback`.
4. Из Overview взять Directory (tenant) ID и Application (client) ID. Внести в `backend/.env` как `MICROSOFT_TENANT_ID` и `MICROSOFT_CLIENT_ID`.
5. Для локальной разработки создать Client Secret в Certificates & secrets. Его **Value**, а не Secret ID, записать только в `backend/.env` как `MICROSOFT_CLIENT_SECRET`. Не присылать пароль/секрет в чат и не добавлять его в `VITE_*`.
6. Token configuration → Add optional claim → **ID token** → `acct`. Если используете manifest, добавить `{ "name": "acct", "essential": true }` в `optionalClaims.idToken`, сохранив остальные нужные claims. Без этого вход намеренно закрыт. Scopes приложения: `openid profile email`; Graph-доступ, почта и refresh tokens не запрашиваются.
7. Если политика tenant требует admin consent или назначения пользователей приложению, администратор должен выполнить эти настройки. Перезапустить backend после заполнения `.env`.

Инструкции Microsoft: [регистрация и Web platform](https://learn.microsoft.com/en-us/graph/auth-register-app-v2), [добавление optional claims](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims).

Локальные `SESSION_SECRET` и `AUTH_ENCRYPTION_KEY` уже сгенерированы и сохранены в игнорируемом `.env`, без вывода значений. Для другого окружения нужны собственные случайные значения: session secret минимум 32 символа, AES-ключ ровно 32 случайных байта в Base64. Замена AES-ключа без расшифровки/перешифрования существующих секретов сделает их непригодными. Секреты и резервную копию ключа хранить отдельно от Git.

`UNIVERSITY_EMAIL_DOMAINS=astanait.edu.kz` — точный список доменов через запятую. Локально используются backend `http://localhost:3101` и frontend `http://localhost:5173`, так как 3001 был занят существующим процессом. В `.env.example` показан стандартный порт 3001; при выборе другого порта синхронно измените `PORT`, `MICROSOFT_REDIRECT_URI`, регистрацию Entra и `frontend/.env` (`VITE_API_URL`). `FRONTEND_ORIGIN` должен быть точным origin без завершающего `/`.

## API для будущего frontend

Все запросы выполняются к backend. `fetch` должен использовать `credentials: 'include'`. Сессия хранится в HttpOnly cookie; access/refresh tokens и JWT не передаются frontend и не хранятся в localStorage.

- **GET `/api/auth/session`** → `{status, configured, csrfToken?, user?}`. Допустимые состояния: `anonymous`, `enrollment_required`, `two_factor_required`, `authenticated`. `user` содержит только `id` (строка BIGINT), `email`, `name`, `role`, `two_factor_enabled`. `configured=false` означает, что конфигурация сервера не завершена; не показывать фиктивный успешный вход.
- **GET `/api/auth/microsoft`** → HTTP redirect в Microsoft. Открывать как обычную навигацию, например `window.location.assign(API + '/api/auth/microsoft')`; не через fetch. Незавершённая конфигурация возвращает 503.
- **GET `/api/auth/microsoft/callback`** — только для Microsoft. Приложение возвращает браузер на `FRONTEND_ORIGIN`; после этого снова запросить `/session`. При ошибке frontend получает `?auth_error=...`, без токенов в URL. Возможные коды: `UNIVERSITY_ACCOUNT_REQUIRED`, `ACCOUNT_LINK_REQUIRED`, `ACCOUNT_DISABLED`, `MICROSOFT_LOGIN_FAILED`.

  Для `UNIVERSITY_ACCOUNT_REQUIRED` дополнительно передаётся безопасный `auth_reason`: `MEMBER_CLAIM_MISSING` (добавить `acct` именно в ID token приложения), `MEMBER_ACCOUNT_REQUIRED` (гость/неподдерживаемый тип), `TENANT_MISMATCH`, `OBJECT_ID_MISSING` или `UNIVERSITY_DOMAIN_REQUIRED`. В терминале выводится только фиксированный код причины, без claims, email, URL callback или токенов. Отсутствие `acct` не считается доказательством того, что пользователь гостевой; до настройки claim вход остаётся закрытым.
- **POST `/api/auth/2fa/setup`**, без тела — только после первого фактора и до настройки 2FA. Возвращает `{secret, qrCode}`; `qrCode` — локально созданный PNG data URL. Показывать в памяти страницы, не сохранять в localStorage и не отправлять сторонним QR-сервисам. Повторный запрос в той же незавершённой сессии возвращает тот же ключ.
- **POST `/api/auth/2fa/confirm`**, JSON `{code: "123456"}` — подтверждает первоначальную настройку. Возвращает `{status: "authenticated", user, csrfToken, recoveryCodes}`. 10 резервных кодов показываются **один раз**; frontend должен предложить пользователю сохранить их отдельно.
- **POST `/api/auth/2fa/verify`**, JSON `{code: "123456"}` — обычный второй этап. Можно передать резервный код вместо TOTP. Возвращает `{status: "authenticated", user, csrfToken}`.
- **POST `/api/auth/logout`** → 204. Уничтожает серверную сессию. Это выход из BookAITU; он не завершает все сессии Microsoft пользователя.

Для каждого POST/DELETE передавайте `X-CSRF-Token` из последнего `/session` или ответа успешного второго фактора. Браузер передаст `Origin` автоматически; запросы изменения принимаются только с `FRONTEND_ORIGIN`. После смены сессии заменяйте CSRF-токен. При ручной проверке HTTP-клиентом тоже нужно передавать точный Origin. Не отключать CSRF из-за CORS.

```js
const API = 'http://localhost:3101';
const state = await fetch(`${API}/api/auth/session`, {
  credentials: 'include',
}).then(r => r.json());

// После Microsoft callback: state.status определяет следующий экран.
const response = await fetch(`${API}/api/auth/2fa/verify`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrfToken },
  body: JSON.stringify({ code: codeFromInput }),
});
// Проверять response.ok до использования результата.
```

Статусы ошибок: 400 — некорректное тело; 401 — нет завершённой сессии или неверный/повторный код; 403 — чужой origin/CSRF, отключённый аккаунт или недостаточно прав; 409 — неподходящий этап/нужна привязка; 429 — ограничение попыток; 503 — Microsoft-вход не настроен. Ответы ошибок не содержат токенов или данных PostgreSQL.

## Доступ к бизнес-API

Административный дашборд, управление пользователями/помещениями/бронями и аудит описаны отдельно в [ADMIN.md](ADMIN.md). Все `/api/admin/*` требуют завершённой 2FA-сессии и текущей роли администратора.

После завершения обоих этапов доступны `GET /api/rooms`, `GET /api/bookings`, `POST /api/bookings`, `DELETE /api/bookings/:id`. Без полного входа они возвращают 401. Частично пройденный Microsoft-вход не даёт доступа к бронированиям.

При создании бронирования отправляйте `room_id`, `booking_date`, `start_time`, `end_time`, `purpose`. `user_id` определяется сервером по сессии; присланный клиентом `user_id` игнорируется. Пользователь видит и отменяет собственные брони. Администратор видит и может отменить все. `GET /api/users` доступен только администратору. Роль хранится в БД и никогда не назначается по email или данным формы.

При первом входе новый подтверждённый университетский Microsoft-пользователь создаётся с ролью `user`. Если email уже принадлежит legacy-пользователю с другим/пустым Microsoft ID, автоматической привязки нет: `ACCOUNT_LINK_REQUIRED`. Администратор должен отдельно проверить владельца и привязать `tenantId:oid`; существующие роли и данные нельзя присваивать только на основании совпадения почты. Автоматического сброса 2FA без второго фактора нет: восстановление возможно резервным кодом либо через отдельно проверенную административную процедуру.

## Сессии, второй фактор и БД

Миграция `005_auth_sessions.sql` добавляет `auth_sessions` и поля пользователя `two_factor_last_step`, `second_factor_failures`, `second_factor_locked_until`. Она применена после проверенной резервной копии; существующие пользователи, помещения и бронирования сохранены.

- До полного входа сессия/первый фактор действуют 10 минут, после — максимум 8 часов. Идентификатор сессии меняется после Microsoft-входа и второго фактора.
- Сессии — PostgreSQL `auth_sessions`; истёкшие записи удаляются периодически. В сессии нет Microsoft access/refresh token. Незавершённый TOTP-ключ и PKCE verifier в сессии зашифрованы.
- Секрет TOTP — AES-256-GCM с проверкой целостности. Коды — 6 цифр, шаг 30 секунд, допуск времени ±30 секунд. Повторно использованный TOTP не принимается, последний шаг хранится в БД.
- Резервные коды содержат по 128 бит случайности; в БД сохраняются только SHA-256 hashes. Потребление кодов и обновление шага TOTP проходят под `FOR UPDATE`-блокировкой пользователя.
- Пять неверных вторых факторов блокируют аккаунт на 15 минут; новая Microsoft-сессия не сбрасывает счётчик. Дополнительно ограничена частота HTTP-запросов.
- Cookies: HttpOnly, SameSite=Lax; в production также Secure и имя с префиксом `__Host-`. Production требует HTTPS и полной конфигурации. `TRUST_PROXY=1` включать только за одним доверенным HTTPS reverse proxy.

Для production-развёртывания отдельно настраиваются реальные HTTPS origins, инфраструктура, управление секретами/сертификатами Entra и политика доступа tenant. Эта реализация не выдаёт себя за пройденную проверку реального университетского SSO: без регистрационных параметров она ещё не выполнена.

## Запуск и проверки

В `backend`: `npm start`; в `frontend`: `npm run dev`. Простой frontend включает вход, QR-настройку, проверку кода, показ резервных кодов, выход и существующую форму бронирования от имени текущего пользователя. Его можно заменить любым frontend, сохранив описанный контракт.

- `npm test` в backend — тесты Microsoft-identity policy, смены состояний, CSRF, прав бронирования, AES/TOTP/recovery codes, блокировки подбора и защиты legacy-аккаунтов. Для HTTP-тестов используются явно внедряемые тестовые provider/repository и MemoryStore; в рабочем сервере обходных auth endpoints и test-login нет.
- `npm run api:check` — реальное PostgreSQL-хранилище сессий и запрет анонимного доступа к бизнес-API. Проверка не подделывает рабочий Microsoft-вход; созданная сессия удаляется выходом.
- `npm run auth:db:check` — реальные SQL-запросы сервиса 2FA против временной копии таблицы пользователей: подключение TOTP, запрет повторного кода, одноразовость recovery codes и блокировка подбора. Весь тест откатывается, таблицы `public` не изменяются.
- `npm test`, `npm run build` в frontend.

Для завершения живой проверки нужны регистрация приложения, `acct` в ID token, Tenant ID, Client ID и локально сохранённый Client Secret, затем обычный вход пользователя на странице Microsoft и подтверждение TOTP пользователем.
