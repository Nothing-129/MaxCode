import { MessageSquare } from "lucide-react"
import {
  folderTitleTintVars,
  normalizeFolderThemeColor,
} from "@/lib/theme-presets"

const colors = [
  "text-gray-600 dark:text-gray-400",
  "text-red-600 dark:text-red-400",
  "text-orange-600 dark:text-orange-400",
  "text-amber-600 dark:text-amber-400",
  "text-yellow-600 dark:text-yellow-400",
  "text-lime-600 dark:text-lime-400",
  "text-green-600 dark:text-green-400",
  "text-emerald-600 dark:text-emerald-400",
  "text-teal-600 dark:text-teal-400",
  "text-cyan-600 dark:text-cyan-400",
  "text-sky-600 dark:text-sky-400",
  "text-blue-600 dark:text-blue-400",
  "text-indigo-600 dark:text-indigo-400",
  "text-violet-600 dark:text-violet-400",
  "text-purple-600 dark:text-purple-400",
  "text-fuchsia-600 dark:text-fuchsia-400",
  "text-pink-600 dark:text-pink-400",
  "text-rose-600 dark:text-rose-400",
]

const tile = "size-4 shrink-0 rounded-[25%]"

function projectIdentity(name: string) {
  const normalized = name.normalize("NFKC").trim()
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  const letters = Array.from(words[0] ?? "")
  const first = letters[0]
  const han = /\p{Script=Han}/u
  const singleHan = !!first && han.test(first)
  let initials = "PR"
  if (first) {
    let second = ""
    if (!singleHan) {
      if (han.test(normalized)) {
        second = letters[1] && !han.test(letters[1]) ? letters[1] : ""
      } else {
        second =
          letters.slice(1).find((letter) => /\p{N}/u.test(letter)) ??
          (words.length > 1
            ? Array.from(words[words.length - 1])[0]
            : letters.length > 1
              ? letters[letters.length - 1]
              : "") ??
          ""
      }
    }
    initials = Array.from((first + second).toUpperCase())
      .slice(0, 2)
      .join("")
  }
  let color = 0
  for (const letter of normalized.toLowerCase()) {
    color = (color * 31 + letter.codePointAt(0)!) % colors.length
  }
  return { initials, singleHan, color: colors[color] }
}

export function LabProjectBadge({
  name,
  folderColor,
}: {
  name: string | null
  folderColor?: string
}) {
  if (name === null) {
    return (
      <MessageSquare
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
        strokeWidth={1.75}
      />
    )
  }

  const project = projectIdentity(name)
  const isMaxCode = name.trim().toLowerCase() === "maxcode"
  const tint = isMaxCode
    ? undefined
    : folderTitleTintVars(normalizeFolderThemeColor(folderColor))
  const palette = isMaxCode
    ? "bg-[#285ee1] text-white dark:bg-[#82a4ff] dark:text-slate-900"
    : `bg-current/14 ${tint ? "folder-title-tint" : project.color}`
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`${tile} ${palette}`}
      style={tint}
    >
      <text
        x="8"
        y="8"
        dominantBaseline="central"
        textAnchor="middle"
        fill="currentColor"
        fontSize={project.singleHan ? 11 : 9}
        fontWeight="700"
        className={project.singleHan ? "font-sans" : "font-mono"}
      >
        {project.initials}
      </text>
    </svg>
  )
}
