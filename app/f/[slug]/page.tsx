import type { Metadata } from "next";
import { loadFormBySlug } from "../../../lib/formsServer";
import { PublicForm } from "../../../components/form/PublicForm";

export const dynamic = "force-dynamic";

interface Props { params: { slug: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const form = await loadFormBySlug(params.slug).catch(() => null);
  return { title: form ? `${form.title || form.name}｜KAWAI CAMP` : "フォーム｜KAWAI CAMP" };
}

export default async function FormPage({ params }: Props) {
  const form = await loadFormBySlug(params.slug).catch(() => null);

  if (!form || form.status === "draft") {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-6">
        <div className="bg-white border border-gray-200 rounded-2xl px-8 py-10 text-center max-w-sm">
          <p className="text-sm font-bold text-gray-800 mb-1">フォームが見つかりません</p>
          <p className="text-[12.5px] text-gray-500">URLをご確認ください。公開が終了している場合もあります。</p>
        </div>
      </div>
    );
  }

  return <PublicForm form={form} />;
}
