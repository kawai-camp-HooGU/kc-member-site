import type { Task } from "./models";

// タスク完了時のお祝いメッセージを状況に応じて生成
export function getCompletionMessage(task: Pick<Task, "end" | "importance">): string {
  const today = new Date().toISOString().slice(0, 10);
  const end = task.end || "";
  const daysLeft = end ? Math.round((new Date(end).getTime() - new Date(today).getTime()) / 86400000) : null;
  const pick = (arr: string[]): string => arr[Math.floor(Math.random() * arr.length)];
  if (end && end < today)
    return pick(["おつかれさま！しっかり巻き返し完了です💪", "遅れを取り戻して完了！ナイスです🔥", "リカバリー完了、お見事です👏"]);
  if (task.importance === 3)
    return pick(["大物クリア！さすがです✨", "最重要タスクをやり切りました、お見事🎉", "ビッグタスク完了、ナイスです👏"]);
  if (end && daysLeft != null && daysLeft <= 7)
    return pick(["締切に間に合いました！ナイス🎉", "今週の山をひとつ越えました💪", "期限内クリア、おつかれさま！"]);
  if (end && daysLeft != null && daysLeft >= 8)
    return pick(["前倒しで完了！素晴らしいペース👏", "早い！余裕の完了ですね✨", "先回り完了、ナイスです🙌"]);
  const h = new Date().getHours();
  if (h >= 5 && h < 10)  return "朝から好スタート🌅 完了です！";
  if (h >= 17 && h < 21) return "夕方の追い込みナイス🌇 完了です！";
  if (h >= 21 || h < 5)  return "遅くまでおつかれさま🌙 完了です！";
  return pick(["完了！ナイス進捗です🎉", "ひとつ片付きました、おつかれさま！", "タスク完了、いい調子です👍"]);
}

// 完了時のお祝い演出（キラキラ＋トースト）
export function celebrateDone(message: string): void {
  if (typeof document === "undefined") return;
  if (!document.getElementById("done-fx-style")) {
    const st = document.createElement("style");
    st.id = "done-fx-style";
    st.textContent =
      "@keyframes doneToast{0%{transform:translateX(-50%) translateY(14px);opacity:0}12%{transform:translateX(-50%) translateY(0);opacity:1}82%{opacity:1}100%{transform:translateX(-50%) translateY(-10px);opacity:0}}" +
      "@keyframes doneSpk{0%{transform:translate(0,0) scale(0);opacity:0}30%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}}";
    document.head.appendChild(st);
  }
  const t = document.createElement("div");
  t.textContent = message;
  t.style.cssText = "position:fixed;left:50%;top:84px;z-index:9999;background:#1d9e75;color:#fff;font-size:14px;font-weight:500;padding:8px 18px;border-radius:9999px;box-shadow:0 6px 20px rgba(0,0,0,.2);animation:doneToast 2.2s ease forwards;pointer-events:none;white-space:nowrap;";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
  for (let i = 0; i < 9; i++) {
    const s = document.createElement("span");
    const ang = Math.random() * Math.PI * 2, dist = 24 + Math.random() * 34;
    s.textContent = "✦";
    s.style.cssText = "position:fixed;left:50%;top:100px;z-index:9998;font-size:" + (11 + Math.random() * 9) + "px;color:#d4a017;pointer-events:none;--dx:" + (Math.cos(ang) * dist) + "px;--dy:" + (Math.sin(ang) * dist) + "px;animation:doneSpk .9s ease forwards;";
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 950);
  }
}
