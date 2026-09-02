import { HiveWorkspace } from "@/components/hive/hive-workspace";

type PageProps = {
  searchParams: Promise<{ as?: string }>;
};

export default async function Home({ searchParams }: PageProps) {
  const { as } = await searchParams;
  return <HiveWorkspace initialMember={as} />;
}
