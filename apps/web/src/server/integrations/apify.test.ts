import { beforeEach, describe, expect, it, vi } from "vitest";

const actorCall = vi.fn<() => Promise<{ defaultDatasetId?: string }>>();
const listItems = vi.fn<() => Promise<{ items: unknown[] }>>();

vi.mock("apify-client", () => ({
  ApifyClient: class ApifyClient {
    options: unknown;
    actor = vi.fn<() => unknown>(() => ({
      call: actorCall,
    }));
    dataset = vi.fn<() => unknown>(() => ({
      listItems,
    }));

    constructor(options: unknown) {
      this.options = options;
    }
  },
}));

vi.mock("@/env", () => ({
  env: {
    APIFY_API_TOKEN: "test-apify-token",
  },
}));

import { scrapeLinkedInProfile } from "./apify";

beforeEach(() => {
  actorCall.mockReset();
  listItems.mockReset();
});

describe("scrapeLinkedInProfile", () => {
  it("calls the Apify LinkedIn actor and returns the raw dataset item", async () => {
    actorCall.mockResolvedValueOnce({ defaultDatasetId: "dataset-1" });
    listItems.mockResolvedValueOnce({
      items: [
        {
          name: "Louis Adam",
          headline: "Founder at Hyperstack",
          location: "Dublin",
          currentCompany: {
            name: "Hyperstack",
            industry: "Software",
          },
          customActorField: { nested: true },
        },
      ],
    });

    const result = await scrapeLinkedInProfile("https://www.linkedin.com/in/louis-adam1");

    expect(actorCall).toHaveBeenCalledWith({
      profileScraperMode: "Profile details no email ($4 per 1k)",
      queries: ["https://www.linkedin.com/in/louis-adam1"],
    });
    expect(listItems).toHaveBeenCalledWith({ limit: 1 });
    expect(result.fullName).toBe("Louis Adam");
    expect(result.headline).toBe("Founder at Hyperstack");
    expect(result.currentCompany?.name).toBe("Hyperstack");
    expect(result.raw).toEqual({
      name: "Louis Adam",
      headline: "Founder at Hyperstack",
      location: "Dublin",
      currentCompany: {
        name: "Hyperstack",
        industry: "Software",
      },
      customActorField: { nested: true },
    });
  });

  it("uses the LinkedIn URL as a display fallback while preserving raw JSON", async () => {
    actorCall.mockResolvedValueOnce({ defaultDatasetId: "dataset-1" });
    listItems.mockResolvedValueOnce({
      items: [{ id: "profile-1", unknownShape: true }],
    });

    const result = await scrapeLinkedInProfile("https://www.linkedin.com/in/ada-lovelace");

    expect(result.fullName).toBe("Ada Lovelace");
    expect(result.raw).toEqual({ id: "profile-1", unknownShape: true });
  });

  it("extracts the profile image from common Apify profile fields", async () => {
    actorCall.mockResolvedValueOnce({ defaultDatasetId: "dataset-1" });
    listItems.mockResolvedValueOnce({
      items: [
        {
          name: "Grace Hopper",
          profilePictureUrl: "https://media.licdn.com/profile-grace.jpg",
        },
      ],
    });

    const result = await scrapeLinkedInProfile("https://www.linkedin.com/in/grace-hopper");

    expect(result.profileImageUrl).toBe("https://media.licdn.com/profile-grace.jpg");
  });

  it("finds nested profile image URLs without using company logos", async () => {
    actorCall.mockResolvedValueOnce({ defaultDatasetId: "dataset-1" });
    listItems.mockResolvedValueOnce({
      items: [
        {
          name: "Katherine Johnson",
          currentCompany: {
            name: "NASA",
            logoUrl: "https://example.com/company-logo.png",
          },
          profile: {
            images: {
              avatar: "https://media.licdn.com/profile-katherine.jpg",
            },
          },
        },
      ],
    });

    const result = await scrapeLinkedInProfile("https://www.linkedin.com/in/katherine-johnson");

    expect(result.profileImageUrl).toBe("https://media.licdn.com/profile-katherine.jpg");
    expect(result.currentCompany?.logoUrl).toBe("https://example.com/company-logo.png");
  });
});
