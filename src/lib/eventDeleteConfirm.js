// @ts-check
/**
 * Один текст вопроса «удалить событие?» — на все оболочки события.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ДОМ. Оболочек у события три (окно просмотра `EventModal`,
 * панель просмотра `EventSourcePanel`, форма `EventEditDialog`), и до перевода
 * на канон в каждой жила СВОЯ копия подтверждения — собственная стейт-машина с
 * баннером. Перевод на общий `useConfirm()` убрал стейт-машины, но оставил бы
 * три побайтово одинаковых набора копии, отличающихся только источником имени.
 * Это та же ошибка одним слоем выше: четвёртая оболочка события завела бы
 * четвёртую формулировку, и «удалить отель?» разъехалось бы с «удалить отель?».
 *
 * ТОЧКА РАСХОЖДЕНИЯ — КОЛБЭК, а не текст (feedback-unify-behavior-across-
 * identical-elements): что именно удалять и как — знает вызыватель, он и
 * передаёт `onConfirm`; ЧТО СПРОСИТЬ — знает этот файл, один на всех.
 *
 * Чистая функция без React и i18n-контекста: `t` приходит аргументом, поэтому
 * файл проверяется обычным `node --test` (тот же приём, что у `proUpsell.js`).
 *
 * @param {(k: string, p?: Record<string, any>) => string} t
 * @param {string} label   локализованное имя типа («Отель», «Трансфер», «Услуга»)
 * @param {() => Promise<any> | any} onConfirm  промис записи; его держит спиннер confirm-а
 * @returns {{ title: string, description: string, confirmLabel: string, variant: 'destructive', onConfirm: () => any }}
 */
export function eventDeleteConfirm(t, label, onConfirm) {
  return {
    title: t('event.delete_q', { label: String(label || '').toLowerCase() }),
    description: t('event.delete_irreversible'),
    confirmLabel: t('common.delete'),
    variant: 'destructive',
    onConfirm,
  };
}
