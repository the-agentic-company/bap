import { CoworkerInfoPage } from "./coworker-info-page";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function AgentsCoworkerInfoRoute({ params }: PageProps) {
  const { slug } = await params;

  return <CoworkerInfoPage coworkerSlug={slug} />;
}
