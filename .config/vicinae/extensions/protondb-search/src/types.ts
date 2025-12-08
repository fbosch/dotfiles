// Types for ProtonDB and Steam API

export type SteamGame = {
  appid: string;
  name: string;
  icon: string;
  logo: string;
};

export type ProtonDBTier = "borked" | "bronze" | "silver" | "gold" | "platinum" | "native" | "pending";

export type ProtonDBConfidence = "strong" | "moderate" | "weak" | "pending";

export type ProtonDBRating = {
  bestReportedTier: ProtonDBTier;
  confidence: ProtonDBConfidence;
  score: number;
  tier: ProtonDBTier;
  total: number;
  trendingTier: ProtonDBTier;
};

export type GameWithRating = {
  game: SteamGame;
  rating: ProtonDBRating | null;
  isLoadingRating: boolean;
};
