"use client";

import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type ChatTextInputHandle = {
  insertAtCursor: (snippet: string) => void;
  getText: () => string;
};

type ChatTextInputProps = {
  // 파일 업로드 검증에 실패하면 이유를 전달한다. 성공하면 null로 지운다
  onErrorChange?: (message: string | null) => void;
};

const ALLOWED_TEXT_EXTENSIONS = [".txt", ".md"];
const MAX_TEXT_FILE_BYTES = 1 * 1024 * 1024; // PRD: 텍스트 파일 최대 1MB

// DESIGN.md 화면1: 채팅창처럼 텍스트를 직접 입력하거나 텍스트 파일(.txt/.md)을 업로드하는 영역
const ChatTextInput = forwardRef<ChatTextInputHandle, ChatTextInputProps>(
  function ChatTextInput({ onErrorChange }, ref) {
    const [text, setText] = useState("");
    const [fileName, setFileName] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // 값이 바뀐 뒤 커서를 옮겨야 할 위치. textarea.value를 React가 다시 쓰면
    // 브라우저가 커서를 맨 끝으로 되돌리는데, 그 시점 이후에 복원해야 하므로
    // useLayoutEffect(커밋 직후, 페인트 전)에서 처리한다.
    const pendingCursorRef = useRef<number | null>(null);

    useLayoutEffect(() => {
      const textarea = textareaRef.current;
      const cursor = pendingCursorRef.current;
      if (textarea && cursor !== null) {
        // preventScroll을 안 주면 포커스가 이동하면서 브라우저가 화면을
        // 텍스트 상자 쪽으로 강제 스크롤해, 사용자가 보던 위치(이미지 업로드
        // 영역)에서 텍스트 상자 맨 아래로 화면이 튀는 문제가 있었다
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(cursor, cursor);
        pendingCursorRef.current = null;
      }
    }, [text]);

    // 이미지 업로드 영역의 "삽입" 버튼이 이 메서드를 호출해, 현재 커서 위치에 [이미지N]을 끼워 넣는다
    useImperativeHandle(ref, () => ({
      insertAtCursor(snippet: string) {
        const textarea = textareaRef.current;
        if (!textarea) {
          setText((prev) => prev + snippet);
          return;
        }
        const start = textarea.selectionStart ?? text.length;
        const end = textarea.selectionEnd ?? text.length;
        const next = text.slice(0, start) + snippet + text.slice(end);
        pendingCursorRef.current = start + snippet.length;
        setText(next);
        setFileName(null);
      },
      getText: () => text,
    }));

    const handleFileChange = (file: File | undefined) => {
      if (!file) return;

      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (!ALLOWED_TEXT_EXTENSIONS.includes(ext)) {
        onErrorChange?.(
          `.txt 또는 .md 파일만 업로드할 수 있어요. (${file.name})`,
        );
        return;
      }
      if (file.size > MAX_TEXT_FILE_BYTES) {
        onErrorChange?.(
          `텍스트 파일은 최대 1MB까지 업로드할 수 있어요. (${file.name})`,
        );
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        setText(typeof reader.result === "string" ? reader.result : "");
        setFileName(file.name);
        onErrorChange?.(null);
      };
      // 형식·용량은 맞지만 파일 내용이 손상되어 읽지 못하는 경우
      reader.onerror = () => {
        onErrorChange?.(
          `파일을 읽을 수 없어요. 손상된 파일일 수 있어요. (${file.name})`,
        );
      };
      reader.readAsText(file);
    };

    return (
      <div className="flex w-full max-w-md flex-col gap-1 text-left">
        <div className="flex items-center justify-between">
          <label
            htmlFor="poster-text"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            텍스트 입력
          </label>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            텍스트 파일 업로드 (.txt/.md)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md"
            onChange={(e) => handleFileChange(e.target.files?.[0])}
            className="hidden"
          />
        </div>
        <textarea
          ref={textareaRef}
          id="poster-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileName(null);
          }}
          placeholder="포스터에 들어갈 텍스트를 채팅하듯 입력하세요"
          rows={5}
          className="w-full resize-none rounded-lg border border-black/[.15] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/[.2] dark:focus:border-white/40"
        />
        <p className="text-xs text-zinc-400">
          이미지를 특정 위치에 넣고 싶으면 아래 썸네일의 &ldquo;삽입&rdquo;
          버튼을 누르거나, 텍스트에{" "}
          <code className="rounded bg-black/[.06] px-1 py-0.5 dark:bg-white/[.1]">
            [이미지1]
          </code>
          처럼 직접 입력하세요.
        </p>
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>{fileName ? `업로드한 파일: ${fileName}` : ""}</span>
          <span>{text.length.toLocaleString()}자</span>
        </div>
      </div>
    );
  },
);

export default ChatTextInput;
