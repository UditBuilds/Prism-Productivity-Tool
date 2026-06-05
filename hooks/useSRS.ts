import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";

import type { SrsCard } from "@/types/database";

const CARDS_KEY = ["srs-cards"] as const;

export interface CreateCardInput {
  front: string;
  back: string;
  deck_name?: string;
  note_id?: string | null;
}

export interface UpdateCardInput {
  id: string;
  front?: string;
  back?: string;
  deck_name?: string;
}

export interface DeckStat {
  deckName: string;
  total: number;
  dueCount: number;
  lastReviewed: string | null;
  /** Dominant source note id, if most cards in the deck share one (else null). */
  noteId: string | null;
}

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function request<T>(
  url: string,
  method: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.error || json.data === null) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json.data;
}

const fetchAllCards = () => request<SrsCard[]>("/api/srs/cards", "GET");

function isDue(card: SrsCard, now: number): boolean {
  return new Date(card.next_review).getTime() <= now;
}

/** All cards for the user (the single source of truth for the SRS cache). */
export function useAllCards() {
  return useQuery<SrsCard[]>({
    queryKey: CARDS_KEY,
    queryFn: fetchAllCards,
  });
}

/** Due cards (next_review <= now), optionally filtered to one deck. */
export function useDueCards(deck?: string) {
  return useQuery<SrsCard[], Error, SrsCard[]>({
    queryKey: CARDS_KEY,
    queryFn: fetchAllCards,
    select: (cards) => {
      const now = Date.now();
      return cards.filter(
        (c) => isDue(c, now) && (!deck || c.deck_name === deck)
      );
    },
  });
}

/** Per-deck stats grouped by deck_name. Default deck sorts first. */
export function useDeckStats() {
  return useQuery<SrsCard[], Error, DeckStat[]>({
    queryKey: CARDS_KEY,
    queryFn: fetchAllCards,
    select: (cards) => {
      const now = Date.now();
      const byDeck = new Map<string, DeckStat>();
      // Tally note_id occurrences per deck to find each deck's dominant source.
      const noteCounts = new Map<string, Map<string, number>>();

      for (const card of cards) {
        const stat = byDeck.get(card.deck_name) ?? {
          deckName: card.deck_name,
          total: 0,
          dueCount: 0,
          lastReviewed: null,
          noteId: null,
        };
        stat.total += 1;
        if (isDue(card, now)) stat.dueCount += 1;
        if (
          card.last_reviewed &&
          (!stat.lastReviewed || card.last_reviewed > stat.lastReviewed)
        ) {
          stat.lastReviewed = card.last_reviewed;
        }
        byDeck.set(card.deck_name, stat);

        if (card.note_id) {
          const counts =
            noteCounts.get(card.deck_name) ?? new Map<string, number>();
          counts.set(card.note_id, (counts.get(card.note_id) ?? 0) + 1);
          noteCounts.set(card.deck_name, counts);
        }
      }

      // A deck's source note = the note_id shared by a majority of its cards.
      const decks = Array.from(byDeck.values());
      for (const stat of decks) {
        const counts = noteCounts.get(stat.deckName);
        if (!counts) continue;
        let bestId: string | null = null;
        let bestCount = 0;
        for (const [id, count] of Array.from(counts.entries())) {
          if (count > bestCount) {
            bestId = id;
            bestCount = count;
          }
        }
        if (bestId && bestCount * 2 > stat.total) stat.noteId = bestId;
      }

      return decks.sort((a, b) => {
        if (a.deckName === "Default") return -1;
        if (b.deckName === "Default") return 1;
        return a.deckName.localeCompare(b.deckName);
      });
    },
  });
}

export function useCreateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCardInput) =>
      request<SrsCard>("/api/srs/cards", "POST", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: CARDS_KEY });
      const previous = qc.getQueryData<SrsCard[]>(CARDS_KEY) ?? [];
      const now = new Date().toISOString();
      const optimistic: SrsCard = {
        id: `optimistic-${crypto.randomUUID()}`,
        user_id: "optimistic",
        note_id: input.note_id ?? null,
        front: input.front,
        back: input.back,
        deck_name: input.deck_name?.trim() || "Default",
        interval_days: 1,
        ease_factor: 2.5,
        repetitions: 0,
        next_review: now, // brand-new cards are due immediately
        last_reviewed: null,
        created_at: now,
        updated_at: now,
      };
      qc.setQueryData<SrsCard[]>(CARDS_KEY, [optimistic, ...previous]);
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(CARDS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to create card");
    },
    onSuccess: () => toast.success("Card created"),
    onSettled: () => qc.invalidateQueries({ queryKey: CARDS_KEY }),
  });
}

export function useUpdateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCardInput) =>
      request<SrsCard>("/api/srs/cards", "PATCH", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: CARDS_KEY });
      const previous = qc.getQueryData<SrsCard[]>(CARDS_KEY) ?? [];
      qc.setQueryData<SrsCard[]>(
        CARDS_KEY,
        previous.map((c) =>
          c.id === input.id
            ? { ...c, ...input, updated_at: new Date().toISOString() }
            : c
        )
      );
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(CARDS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to update card");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CARDS_KEY }),
  });
}

export function useDeleteCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ id: string }>("/api/srs/cards", "DELETE", { id }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: CARDS_KEY });
      const previous = qc.getQueryData<SrsCard[]>(CARDS_KEY) ?? [];
      qc.setQueryData<SrsCard[]>(
        CARDS_KEY,
        previous.filter((c) => c.id !== id)
      );
      return { previous };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(CARDS_KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : "Failed to delete card");
    },
    onSuccess: () => toast.success("Card deleted"),
    onSettled: () => qc.invalidateQueries({ queryKey: CARDS_KEY }),
  });
}

export interface SubmitReviewInput {
  card_id: string;
  rating: number;
}

/** Grade a card. Server runs SM-2; we refresh the cards cache on success. */
export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitReviewInput) =>
      request<SrsCard>("/api/srs/review", "POST", input),
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to save review"
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CARDS_KEY });
    },
  });
}

export interface GeneratedCard {
  front: string;
  back: string;
}

/**
 * Generate draft cards from a note via the AI provider. Does NOT persist — the modal
 * lets the user review/edit before saving. Errors surface to the caller (the
 * modal renders them inline), so no toast here.
 */
export function useGenerateCards() {
  return useMutation({
    mutationFn: (noteId: string) =>
      request<GeneratedCard[]>("/api/srs/generate", "POST", {
        note_id: noteId,
      }),
  });
}

export interface SaveGeneratedCardsInput {
  cards: {
    front: string;
    back: string;
    deck_name: string;
    note_id?: string | null;
  }[];
  /** Deck name for the success toast (same value the cards carry). */
  deckName: string;
}

/** Bulk-save reviewed cards (array POST), then refresh the cards cache. */
export function useSaveGeneratedCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveGeneratedCardsInput) =>
      request<SrsCard[]>("/api/srs/cards", "POST", input.cards),
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: CARDS_KEY });
      const n = data.length;
      toast.success(
        `${n} card${n === 1 ? "" : "s"} added to ${variables.deckName} deck`
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save cards");
    },
  });
}
