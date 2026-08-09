/**
 * ПЕРИМЕТР ЭПИКА — тест предиката (TRIP-337, Г19)
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. `perimeter.mjs` - не гард, а ПРЕДИКАТ, который гарды
 * (2o, 2q) и аудит применяют к чужим деревьям. У него нет своего выхода и своего
 * вердикта, поэтому он не ловится ни одним тестом на гард: любой из них зелен и
 * при неверном периметре - просто судит другое множество файлов. Ровно так и
 * прожил дефект Г19: `login.css` исключён, `Login.jsx` нет, оба гарда зелёные.
 *
 * ЧТО ПИНИТСЯ. Не «список файлов», а ДВА свойства, каждое из которых уже
 * ломалось или могло сломаться молча:
 *   1) экран входа исключён ОБЕИМИ половинами - и стилем, и разметкой. Половина
 *      предиката требовала пересадки экрана, вторая её запрещала;
 *   2) исключение привязано к ГРАНИЦЕ СЕГМЕНТА пути, а не к подстроке. Иначе
 *      имя-однокоренник (`MyLogin.jsx`, `TermsOfServiceCard.jsx`) уезжает из
 *      наблюдения бесшумно, а вывод файла из знаменателя ПОДНИМАЕТ долю «собрано
 *      из ДС» - то есть ошибка предиката выглядит как прогресс.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inScope, OUT_OF_SCOPE } from './perimeter.mjs';

test('экран входа исключён ЦЕЛИКОМ — и стиль, и разметка (Г19)', () => {
  assert.equal(inScope('src/pages/login.css'), false);
  assert.equal(inScope('src/pages/Login.jsx'), false, 'разметка входа судилась, стили нет — это и был Г19');
});

test('остальные объявленные исключения на месте', () => {
  for (const f of [
    'src/pages/PublicTrip.jsx',
    'src/pages/PublicTrip.css',
    'src/pages/JoinTrip.jsx',
    'src/components/SiteChrome.jsx',
    'src/pages/LandingPage.jsx',
    'src/pages/Privacy.jsx',
    'src/pages/Terms.jsx',
  ]) assert.equal(inScope(f), false, f);
});

test('★ обычный экран периметра НЕ исключён — иначе тест зелен над пустой комнатой', () => {
  for (const f of [
    'src/pages/ScreenAccount.jsx',
    'src/pages/BudgetLens.jsx',
    'src/design/app.css',
    'src/pages/EditLens.jsx',
  ]) assert.equal(inScope(f), true, f);
});

test('★ ЛЕВАЯ граница: однокоренное имя в начале сегмента — НЕ экран входа', () => {
  // Ошибка в эту сторону не краснеет нигде: файл исчезает из знаменателя, а доля
  // «собрано из ДС» РАСТЁТ, то есть молчаливый пропуск читается как прогресс.
  assert.equal(inScope('src/components/MyLoginBanner.jsx'), true);
  assert.equal(inScope('src/components/TripLanding.jsx'), true);
  assert.equal(inScope('src/components/PaymentTerms.jsx'), true);
  // А тот же файл сегментом пути - исключён.
  assert.equal(inScope('src/pages/Login.jsx'), false);
  assert.equal(inScope('Login.jsx'), false, 'якорь ^ обязан работать без каталога');
});

test('★ ПРАВАЯ граница у КОНКРЕТНОГО файла: хвост сегмента не исключается (ревью Codex)', () => {
  // `Login.jsx`/`login.css` названы ЦЕЛИКОМ, значит сегмент обязан кончиться
  // вместе с ними. Без этого `Login.jsx.test.js` и каталог `Login.jsx/...`
  // уезжали из наблюдения молча — та же несимметричная цена, что у левой
  // границы, только с другого конца.
  assert.equal(inScope('src/pages/Login.jsx.test.js'), true);
  assert.equal(inScope('src/pages/Login.jsx/snapshot.js'), true);
  assert.equal(inScope('src/pages/login.css.map'), true);
});

test('★ у ПРЕФИКСНЫХ записей правой границы НЕТ — иначе они перестанут ловить свой файл', () => {
  // `Landing`/`PublicTrip`/`Terms` — префиксы имени, а не файлы: хвост им нужен.
  assert.equal(inScope('src/pages/LandingPage.jsx'), false);
  assert.equal(inScope('src/pages/PublicTrip.jsx'), false);
  assert.equal(inScope('src/pages/PublicTrip.css'), false);
  assert.equal(inScope('src/pages/TermsOfService.jsx'), false);
});

test('предикат — регулярка без флага g (иначе lastIndex делает ответ зависимым от порядка вызовов)', () => {
  assert.equal(OUT_OF_SCOPE.global, false);
  // Тот же вопрос дважды подряд обязан дать тот же ответ.
  assert.equal(inScope('src/pages/Login.jsx'), inScope('src/pages/Login.jsx'));
});
