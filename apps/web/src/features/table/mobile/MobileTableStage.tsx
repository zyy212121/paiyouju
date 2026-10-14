import type { ReactNode } from "react";

export function MobileTableStage({ action, animation, board, center, children, connection, hero, seated, topBar }: {
  readonly action: ReactNode;
  readonly animation: ReactNode;
  readonly board: ReactNode;
  readonly center: ReactNode;
  readonly children: ReactNode;
  readonly connection: ReactNode;
  readonly hero: ReactNode;
  readonly seated: boolean;
  readonly topBar: ReactNode;
}) {
  return <main className="mobile-table-stage" data-testid="mobile-table-stage" data-view-mode={seated ? "seated" : "spectator"}><div aria-hidden="true" className="table-stage-texture" />{topBar}{connection}<section className="table-play-space"><div className="table-seat-layer">{children}</div>{center}<div className="table-board-layer">{board}</div>{animation}</section>{seated && <><div className="table-hero-layer">{hero}</div><div className="table-action-layer">{action}</div></>}</main>;
}
