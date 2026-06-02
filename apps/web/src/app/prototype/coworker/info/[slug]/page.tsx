import { CoworkerInfoPrototype } from "./coworker-info-prototype";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function PrototypeCoworkerInfoPage({ params }: PageProps) {
  const { slug } = await params;

  return <CoworkerInfoPrototype coworkerSlug={slug} />;
}
