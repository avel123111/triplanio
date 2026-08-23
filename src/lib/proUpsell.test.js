import test from 'node:test';
import assert from 'node:assert/strict';
import { proUpsellCopy, proUpsellFooter, proRole, PRO_ROLES, PRO_SOURCES } from './proUpsell.js';

// ГЛАВНЫЙ инвариант: кнопка оплаты — только у владельца. Участник платит за трип,
// которого его платёж не откроет, поэтому «ни при каком источнике» тут не
// перестраховка, а требование к деньгам.
test('участник не получает кнопку апгрейда ни из одного источника', () => {
  for (const source of PRO_SOURCES) {
    assert.equal(proUpsellFooter(proRole(false)), 'ask-owner', `source=${source}`);
  }
});

test('владелец получает кнопку апгрейда из любого источника', () => {
  for (const source of PRO_SOURCES) {
    assert.equal(proUpsellFooter(proRole(true)), 'upgrade', `source=${source}`);
  }
});

test('роль выводится из флага владельца', () => {
  assert.equal(proRole(true), 'owner');
  assert.equal(proRole(false), 'member');
});

test('описание зависит от роли: владельцу цельный текст, участнику — имя владельца', () => {
  for (const source of PRO_SOURCES) {
    assert.equal(proUpsellCopy({ role: 'owner', source }).desc, 'locked');
    assert.equal(proUpsellCopy({ role: 'member', source }).desc, 'owner-note');
  }
});

test('название функции попадает в заголовок и в параметры', () => {
  for (const role of PRO_ROLES) {
    const named = proUpsellCopy({ role, source: 'feature', feature: 'Бюджет' });
    assert.ok(named.titleKey.endsWith('_named'), `${role}: именованный ключ`);
    assert.deepEqual(named.titleParams, { feature: 'Бюджет' });

    const plain = proUpsellCopy({ role, source: 'menu' });
    assert.ok(!plain.titleKey.endsWith('_named'), `${role}: ключ без имени функции`);
    assert.equal(plain.titleParams, undefined);
  }
});

// Матрица обязана быть ПОЛНОЙ: у каждой из четырёх комбинаций есть ответ, и ни
// один ключ не пустой. Дырка здесь означает пустой заголовок на живом экране.
test('все четыре комбинации дают заголовок', () => {
  for (const role of PRO_ROLES) {
    for (const source of PRO_SOURCES) {
      const copy = proUpsellCopy({ role, source, feature: source === 'feature' ? 'Чат' : undefined });
      assert.ok(copy.titleKey && copy.titleKey.startsWith('sub.'), `${role}/${source}`);
      assert.ok(copy.desc, `${role}/${source}: вид описания`);
    }
  }
});
