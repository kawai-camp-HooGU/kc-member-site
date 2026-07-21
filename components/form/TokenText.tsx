"use client";
// ============================================================
// 差し込み変数をハイライト表示する入力欄（1行 / 複数行）
//   入力欄の背後に「同じ文字組みの写し」を重ね、{{変数}} だけ色を付ける。
//   入力そのものは素の <input>/<textarea> のままなので、IME・undo・
//   コピペ・スペルチェックといったブラウザ既定の挙動を壊さない。
//   （contentEditable でリッチに描く方式は、日本語入力で確定位置が
//     飛ぶ・undo が効かない等の事故が多いので採らない）
//
//   既知の変数＝紫、閉じ忘れ等の未知の変数＝赤（波線）。
//   色とレイアウトの実体は app/globals.css の .tok-* に集約している。
// ============================================================
import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { splitTokens } from "../../lib/formParse";

export interface TokenTextHandle {
  /** カーソル位置にトークンを差し込む（未フォーカスなら末尾） */
  insert: (token: string) => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** 既知として紫で表示するトークン（例：`{{氏名}}` `{{Q:コース選択}}`） */
  knownTokens: Set<string>;
  /** true で textarea（既定）、false で1行入力 */
  multiline?: boolean;
  placeholder?: string;
  /** 複数行のときの最低の高さ(px) */
  minHeight?: number;
  className?: string;
}

export const TokenText = forwardRef<TokenTextHandle, Props>(function TokenText(
  { value, onChange, knownTokens, multiline = true, placeholder, minHeight = 90, className = "" },
  ref,
) {
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const backRef = useRef<HTMLDivElement | null>(null);
  // IME変換中は写しを隠して実体の文字を出す（未確定文字が見えなくなる事故を防ぐ）
  const [composing, setComposing] = useState(false);

  // 複数行は内容に合わせて伸ばす。内部スクロールを作らないことで
  // 2層のズレ（写しだけスクロールしない）を根本から無くす。
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!multiline || !(el instanceof HTMLTextAreaElement)) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`;
  }, [value, multiline, minHeight]);

  // 1行入力は横スクロールしうるので、写し側の位置を合わせる
  const syncScroll = useCallback(() => {
    const el = inputRef.current;
    const back = backRef.current;
    if (!el || !back) return;
    back.scrollLeft = el.scrollLeft;
    back.scrollTop = el.scrollTop;
  }, []);

  useImperativeHandle(ref, () => ({
    insert: (token: string) => {
      const el = inputRef.current;
      if (!el) { onChange(value + token); return; }
      const s = el.selectionStart ?? value.length;
      const e = el.selectionEnd ?? value.length;
      const next = value.slice(0, s) + token + value.slice(e);
      onChange(next);
      // 差し込み直後のカーソルをトークンの後ろへ置く（続けて書けるように）
      requestAnimationFrame(() => {
        el.focus();
        const pos = s + token.length;
        el.setSelectionRange(pos, pos);
      });
    },
  }), [value, onChange]);

  const parts = splitTokens(value);

  // 実体の入力欄に共通で渡すもの（textarea / input で挙動を揃える）
  const common = {
    className: `tok-input tok-metrics ${composing ? "is-composing" : ""}`,
    value,
    placeholder,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    onScroll: syncScroll,
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: () => setComposing(false),
  };

  return (
    <div className={`tok-wrap ${className}`}>
      <div ref={backRef} aria-hidden="true"
        className={`tok-back tok-metrics ${multiline ? "" : "tok-back-1line"} ${composing ? "is-hidden" : ""}`}>
        {parts.map((p, i) =>
          p.isToken
            ? <span key={i} className={knownTokens.has(p.text) ? "tok" : "tok-bad"}>{p.text}</span>
            : <span key={i}>{p.text}</span>,
        )}
        {/* 末尾が改行だと最終行の高さが出ないので、幅ゼロの番人（ZWSP）を置く */}
        &#8203;
      </div>
      {multiline ? (
        <textarea ref={(el) => { inputRef.current = el; }} style={{ minHeight }} {...common} />
      ) : (
        <input ref={(el) => { inputRef.current = el; }} {...common} />
      )}
    </div>
  );
});
