# Сборка Windows-релиза

Релиз собирается на Windows x64. Обычным пользователям не нужны эти действия: им нужен ZIP из GitHub Releases, см. [первый запуск](first-run.md).

## Локальная сборка

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap.ps1 -Mode setup
$config = Get-Content config/runtime.json -Raw | ConvertFrom-Json
$node = Join-Path $PWD ".runtime/node-v$($config.nodeVersion)-win-x64/node.exe"
& $node node_modules/tsx/dist/cli.mjs --test tests/*.test.ts
& $node scripts/package-windows.mjs
```

Результат: `release/CS2-HUD-<version>-win-x64.zip` и `.zip.sha256`. ZIP уже содержит Electron, отдельный официальный Node.js, скомпилированный backend, собранный frontend, production-зависимости с нативным sharp, ассеты, библиотеку десяти команд и инструкции. Запуск — `CS2 HUD.exe`; браузерный режим — `START_OBS.bat`.

Ручная упаковка следует [документации Electron](https://www.electronjs.org/docs/latest/tutorial/application-distribution): приложение помещается в `resources/app`, EXE переименован. ASAR не используется, чтобы оператор мог заменять SVG/GIF. Backend запускается отдельным Node.js, поэтому встроенный `node:sqlite` не зависит от версии Node внутри Electron и не требует пересборки под Electron ABI.

Копирование в релиз идёт по явному списку. Рабочие `data`, `uploads`, `.env`, GSI-логи, видео и тестовые артефакты не копируются. Папки сборок `.stage-*` остаются в игнорируемой `release/` для диагностики. Их можно удалить вручную после закрытия проверочного приложения; текущие данные пользователей лежат отдельно.

## Автоматические проверки

`package-windows.mjs` перед ZIP запускает `smoke-release.mjs` на фактически собранной папке. Проверяются backend, SQLite, native sharp, HTML/карты/ассеты/библиотека/GSI cfg, затем собственный сервер и прозрачное окно Electron. Используются временные DATA_DIR и свободные порты. Из PATH удаляются Node.js и инструменты разработчика. Создание окна проверяется без показа поверх игры; это не проверка захвата в живом CS2/OBS.

Для повторной проверки уже распакованного архива:

```powershell
& $node scripts/smoke-release.mjs 'C:\папка\CS2-HUD-0.2.0-win-x64'
```

## GitHub Actions и публикация

`.github/workflows/windows.yml` собирает и проверяет Windows ZIP при push в main и вручную через Actions. Архив доступен в **Artifacts → CS2-HUD-Windows-x64**. При публикации тега `v<version>` после успешной проверки создаётся GitHub Release с ZIP и SHA-256. Уже существующий релиз не перезаписывается.

Перед выпуском измените `package.json.version`, обновите инструкции, выполните проверки, закоммитьте, затем создайте и отправьте соответствующий тег. В `config/runtime.json` закреплены Node.js, SHA-256 официального Windows ZIP и pnpm. Если меняете Node.js, обновляйте версию и хеш вместе с официального `nodejs.org/dist`; не отключайте проверку хеша или TLS.

## Обновления и подпись

Автообновление приложения не реализовано: новая версия распаковывается отдельно после полного выхода из старой. Настройки готовых версий общие в `%LOCALAPPDATA%\CS2HUD`. Исходники сохраняют `data` в папке проекта; автоматического импорта чужой базы нет. Иконки, заменённые оператором в папке приложения, переносятся отдельно.

EXE не подписан сертификатом издателя. Подписание потребует отдельного сертификата/сервиса владельца репозитория; секреты подписи должны храниться в GitHub Secrets, не в коде. Проверка на чистой виртуальной Windows и с реальным наблюдателем CS2 остаётся полезным этапом перед массовым распространением.
