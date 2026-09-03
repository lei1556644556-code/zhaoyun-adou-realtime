export interface OwnedProp {
  id: number;
  level: number;
}
export interface ShopOffer {
  id: number;
  /** This offer was an ad offer in 1.0.9 and is a one-click claim on the web. */
  freeByAd: boolean;
  claimed?: boolean;
}

export interface PendingMatchResult {
  matchKey: string;
  won: boolean;
  baseReward: number;
}

export interface PendingShop {
  matchKey: string;
  offers: ShopOffer[];
  lotteryIds: number[];
  lotteryUsed: boolean;
  lotteryWinnerId?: number;
}

export interface AccountEconomy {
  dayKey: string;
  gold: number;
  stamina: number;
  winDay: number;
  loseDay: number;
  ownedProps: OwnedProp[];
  completedMatchKeys: string[];
  pendingResult?: PendingMatchResult;
  pendingShop?: PendingShop;
}
