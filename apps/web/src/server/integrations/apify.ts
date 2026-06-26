import { ApifyClient } from "apify-client";
import { env } from "@/env";

export type LinkedInCompany = {
  name: string | null;
  website: string | null;
  industry: string | null;
  description: string | null;
  employeeCount: string | null;
  linkedinUrl: string | null;
  logoUrl: string | null;
};

export type LinkedInProfileResult = {
  profileUrl: string;
  fullName: string | null;
  headline: string | null;
  jobTitle: string | null;
  /** Current company name (kept flat for convenience). */
  company: string | null;
  location: string | null;
  summary: string | null;
  profileImageUrl: string | null;
  currentCompany: LinkedInCompany | null;
  raw: Json;
};

type Json = Record<string, unknown>;

const LINKEDIN_PROFILE_ACTOR_ID = "LpVuK3Zozwuipa5bp";
const PROFILE_SCRAPER_MODE = "Profile details no email ($4 per 1k)";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asJson(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (Array.isArray(value)) {
      const found = value.map(asString).find(Boolean);
      if (found) {
        return found;
      }
      continue;
    }
    const found = asString(value);
    if (found) {
      return found;
    }
  }
  return null;
}

function asHttpUrl(value: unknown): string | null {
  const candidate = asString(value);
  if (!candidate) {
    return null;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function profileImageFromRaw(raw: Json): string | null {
  const direct = firstString(
    raw.profileImageUrl,
    raw.profile_image_url,
    raw.profileImage,
    raw.profile_image,
    raw.profilePicture,
    raw.profile_picture,
    raw.profilePictureUrl,
    raw.profile_picture_url,
    raw.profilePic,
    raw.profile_pic,
    raw.profilePicUrl,
    raw.profile_pic_url,
    raw.profilePhoto,
    raw.profile_photo,
    raw.profilePhotoUrl,
    raw.profile_photo_url,
    raw.memberPhoto,
    raw.member_photo,
    raw.avatar,
    raw.avatarUrl,
    raw.avatar_url,
    raw.image,
    raw.imageUrl,
    raw.image_url,
    raw.photo,
    raw.photoUrl,
    raw.photo_url,
    raw.picture,
    raw.pictureUrl,
    raw.picture_url,
  );
  const directUrl = asHttpUrl(direct);
  if (directUrl) {
    return directUrl;
  }

  return findProfileImageUrl(raw);
}

function findProfileImageUrl(value: unknown, path: string[] = []): string | null {
  if (path.length > 6) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProfileImageUrl(item, path);
      if (found) {
        return found;
      }
    }
    return null;
  }

  const object = asJson(value);
  if (!object) {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(object)) {
    const lowerPath = [...path, key].join(".").toLowerCase();
    const looksLikeProfileImage =
      /(profile|member|avatar|photo|picture|image|pic)/.test(lowerPath) &&
      !/(company|logo|background|banner|cover)/.test(lowerPath);
    if (looksLikeProfileImage) {
      const url = asHttpUrl(nestedValue);
      if (url) {
        return url;
      }
    }

    const found = findProfileImageUrl(nestedValue, [...path, key]);
    if (found) {
      return found;
    }
  }

  return null;
}

function nameFromUrl(profileUrl: string): string {
  try {
    const path = new URL(profileUrl).pathname.replace(/\/+$/, "");
    const slug = path.slice(path.lastIndexOf("/") + 1);
    const cleaned = slug
      .replace(/-[0-9a-f]{6,}$/i, "")
      .replace(/-/g, " ")
      .trim();
    if (!cleaned) {
      return "LinkedIn Member";
    }
    return cleaned
      .split(" ")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "LinkedIn Member";
  }
}

function companyFromRaw(raw: Json): LinkedInCompany | null {
  const company = asJson(raw.currentCompany) ?? asJson(raw.current_company);
  const companyName = firstString(
    company?.name,
    company?.companyName,
    raw.companyName,
    raw.company_name,
    raw.company,
  );
  if (!companyName) {
    return null;
  }

  return {
    name: companyName,
    website: firstString(company?.website, company?.site, raw.companyWebsite),
    industry: firstString(company?.industry, company?.industries, raw.companyIndustry),
    description: firstString(company?.description, company?.about, raw.companyDescription),
    employeeCount: firstString(
      company?.employeeCount,
      company?.employees,
      company?.companySize,
      raw.companySize,
    ),
    linkedinUrl: firstString(
      company?.linkedinUrl,
      company?.linkedInUrl,
      company?.url,
      raw.companyLinkedinUrl,
      raw.companyUrl,
    ),
    logoUrl: firstString(company?.logoUrl, company?.logo, raw.companyLogo),
  };
}

function profileFromRaw(profileUrl: string, raw: Json): LinkedInProfileResult {
  const currentCompany = companyFromRaw(raw);
  const location = [firstString(raw.city), firstString(raw.country, raw.country_code)]
    .filter(Boolean)
    .join(", ");

  return {
    profileUrl,
    fullName:
      firstString(raw.fullName, raw.full_name, raw.name, raw.profileName) ??
      nameFromUrl(profileUrl),
    headline: firstString(raw.headline, raw.subtitle, raw.position, raw.title),
    jobTitle: firstString(raw.jobTitle, raw.job_title, raw.position, raw.title, raw.headline),
    company: currentCompany?.name ?? firstString(raw.companyName, raw.company_name, raw.company),
    location: location || firstString(raw.location),
    summary: firstString(raw.summary, raw.about, raw.description),
    profileImageUrl: profileImageFromRaw(raw),
    currentCompany,
    raw,
  };
}

/** Scrape a LinkedIn profile via Apify and keep the full dataset item for LLM analysis. */
export async function scrapeLinkedInProfile(profileUrl: string): Promise<LinkedInProfileResult> {
  const token = env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error("APIFY_API_TOKEN is not configured");
  }

  const client = new ApifyClient({ token });
  const run = await client.actor(LINKEDIN_PROFILE_ACTOR_ID).call({
    profileScraperMode: PROFILE_SCRAPER_MODE,
    queries: [profileUrl],
  });
  const datasetId = run.defaultDatasetId;
  if (!datasetId) {
    throw new Error("Apify LinkedIn actor finished without a default dataset");
  }

  const { items } = await client.dataset(datasetId).listItems({ limit: 1 });
  const raw = asJson(items[0]);
  if (!raw) {
    throw new Error("Apify LinkedIn actor returned no profile records");
  }

  return profileFromRaw(profileUrl, raw);
}
