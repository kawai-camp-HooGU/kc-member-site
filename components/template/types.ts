// テンプレート編集中の緩い型（数値入力は編集中に文字列になり得る／保存時にDB変換）
export interface EditTask {
  name: string;
  importance: string | number;   // "none" | 1|2|3 | "1".. （編集中）
  startOffset: number | string;  // "" 許可
  endOffset: number | string;
  progressMemo?: string;
  specialNotes?: string;
  materials?: string;
}
export interface EditAnken { name: string; tasks: EditTask[]; }
export interface EditTemplate { id: number | null; name: string; anken: EditAnken[]; }
