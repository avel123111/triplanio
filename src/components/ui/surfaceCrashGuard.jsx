import { Component, createContext } from 'react';
import { Sentry } from '@/lib/sentry';

// Граница краха поверхности (TRIP-515).
//
// Краш при рендере/коммите внутри ОТКРЫТОЙ модалки или шита (переводчик отцепил
// наш текстовый узел → React бросает на insertBefore) обязан стоить «окно не
// открылось», а не «умерло всё приложение». Эта граница оборачивает поверхность
// в КОРНЕВОМ композере каждого шва (SheetRoot / Dialog / AlertDialog-owner /
// VisitPanel — слой, у которого в руках `onOpenChange`; Content его не видит).
// Гард 2f требует, чтобы каждый файл шва её нёс.
//
// При отлове граница:
//   • рисует НИЧЕГО (тихо) — никакого болтающегося retry-блока в потоке страницы;
//   • ЗАКРЫВАЕТ поверхность. Просто погасить содержимое мало: скрим и ловушка
//     фокуса остались бы смонтированными, а владелец с обещанием (ConfirmProvider
//     держит resolverRef) НИКОГДА бы его не разрешил — и вызыватель с
//     `await confirm()` завис бы навсегда. Закрытие идёт двумя путями:
//       — onClose() = onOpenChange(false): штатное закрытие для любой поверхности;
//       — SurfaceCrashContext (жёсткая отмена владельца): нужна там, где владелец
//         ГЛОТАЕТ закрытие (busy-guard ConfirmProvider во время async-действия) —
//         именно в этом состоянии происходит наш краш. Контекст течёт СКВОЗЬ
//         портал, поэтому шов дотягивается до владельца без проброса пропов через
//         дженерик Sheet/Dialog.
//   Оба вызова — на СЛЕДУЮЩЕЙ микрозадаче: трогать состояние владельца прямо в
//   упавшем коммите значит перезайти в коммит с предупреждением/циклом.
//
// Сброс — по ВОСХОДЯЩЕМУ фронту `open`: свежее открытие той же поверхности рисует
// её заново. Детей НЕ перемонтируем (перемонтирование убило бы выходную анимацию
// vaul и меняло бы нормальный путь) — в нормальной работе `crashed=false`, дети
// рисуются как есть, поведение не меняется.

/**
 * Владелец, у которого состояние привязано к открытости поверхности (обещание
 * ConfirmProvider), кладёт сюда свою ЖЁСТКУЮ ОТМЕНУ. Значение по умолчанию —
 * `null`: у поверхности без такого владельца жёсткой отмены нет, хватает onClose.
 * @type {import('react').Context<null | (() => void)>}
 */
export const SurfaceCrashContext = createContext(null);

export class SurfaceCrashGuard extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, wasOpen: !!props.open };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  static getDerivedStateFromProps(props, state) {
    // Сброс на восходящем фронте open (закрыто → открыто). Закрытие после краха
    // (open → false) crashed НЕ сбрасывает: содержимое остаётся снятым, пока
    // поверхность гаснет.
    if (props.open && !state.wasOpen) return { crashed: false, wasOpen: true };
    if (!props.open && state.wasOpen) return { wasOpen: false };
    return null;
  }

  componentDidCatch(error, info) {
    try {
      Sentry.captureException(error, {
        tags: { surface: 'frontend', region: 'overlay' },
        contexts: { react: { componentStack: info?.componentStack } },
      });
    } catch { /* Sentry без DSN — no-op */ }
    const hardCancel = this.context; // SurfaceCrashContext владельца или null
    const { onClose } = this.props;
    Promise.resolve().then(() => {
      try { hardCancel?.(); } catch { /* отмена владельца не должна ронять */ }
      try { onClose?.(); } catch { /* закрытие best-effort */ }
    });
  }

  render() {
    return this.state.crashed ? null : this.props.children;
  }
}
SurfaceCrashGuard.contextType = SurfaceCrashContext;
