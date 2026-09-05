import React from 'react';
import { Col } from '@/design/index';
import BudgetSummaryCard, { BudgetSummarySkeleton } from '@/components/trips/BudgetSummaryCard';
import MembersSummaryCard, { MembersSummarySkeleton } from '@/components/trips/MembersSummaryCard';
import ServicesCard, { ServicesSkeleton } from '@/components/trips/ServicesCard';
import PreparationCard, { PreparationSkeleton } from '@/components/trips/PreparationCard';
import TripFrame, { TripFrameSkeleton } from '@/components/trips/TripFrame';
import { useTripAccess } from '@/components/trips/TripAccessContext';

// Скелетон Обзора — то же дерево, что у живого экрана; каждый блок рисует свою
// фазу загрузки сам. Своей геометрии здесь нет: расхождение — прыжок содержимого
// в момент, когда данные приехали.
export function OverviewSkeleton() {
  return (
    <Col gap="g8" className="ovwrap" aria-busy="true">
      <div className="ov-anim"><TripFrameSkeleton /></div>
      <div className="ov-grid">
        <div className="ov-anim"><PreparationSkeleton /></div>
        <Col gap="g8" className="ov-anim">
          <BudgetSummarySkeleton />
          <MembersSummarySkeleton />
          <ServicesSkeleton />
        </Col>
      </div>
    </Col>
  );
}

// Экран поездки: кадр (карта + состояние + числа маршрута) во всю ширину, под
// ним две колонки — «Подготовка» слева, сводки (бюджет · участники · сервисы)
// стопкой справа. Пороги раскладки — по ширине экрана обзора (`@container`),
// не вьюпорта: с боковым меню и без него одна и та же ширина окна даёт разную
// ширину экрана.
export default function OverviewLens({
  trip,
  visits = [],
  transfers = [],
  hotels = [],
  budget,
  budgetExpenses = [],
  budgetCategories = [],
  members = [],
  memberProfiles = {},
  services = [],
  user,
  isLoading = false,
  contentLoading = false,
  active = true,
  budgetEnabled = false,
  onOpenMap,
  onOpenBudget,
  onOpenMembers,
  onAddService,
  onOpenService,
  onBudgetLocked,
  onAddHotel,
  onAddTransfer,
}) {
  // Право управления (editor) — из единого контекста доступа (TRIP-274 Ф2.2),
  // раздаётся подкартам (бюджет/участники) как булев проп.
  const { canEdit: canManage } = useTripAccess();

  if (isLoading) return <OverviewSkeleton />;

  return (
    <Col gap="g8" className="ovwrap">
      <div className="ov-anim">
        <TripFrame
          trip={trip}
          visits={visits}
          transfers={transfers}
          active={active}
          isLoading={contentLoading}
          onOpenMap={onOpenMap}
        />
      </div>

      <div className="ov-grid">
        <div className="ov-anim">
          <PreparationCard
            visits={visits}
            hotels={hotels}
            transfers={transfers}
            isLoading={contentLoading}
            onAddHotel={onAddHotel}
            onAddTransfer={onAddTransfer}
            onOpenRoute={onOpenMap}
          />
        </div>

        <Col gap="g8" className="ov-anim">
          <BudgetSummaryCard
            trip={trip}
            budget={budget}
            budgetExpenses={budgetExpenses}
            budgetCategories={budgetCategories}
            canManage={canManage}
            budgetEnabled={budgetEnabled}
            isLoading={contentLoading}
            onOpen={onOpenBudget}
            onLocked={onBudgetLocked}
          />
          <MembersSummaryCard
            trip={trip}
            members={members}
            profiles={memberProfiles}
            user={user}
            canManage={canManage}
            isLoading={contentLoading}
            onOpenMembers={onOpenMembers}
          />
          <ServicesCard services={services} isLoading={contentLoading} onAddService={onAddService} onOpenService={onOpenService} />
        </Col>
      </div>
    </Col>
  );
}
