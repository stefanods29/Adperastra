import {
  Bold, BringToFront, Brush, ChartColumn, Copy, Download, FileImage, FilePlus, FileText,
  FolderOpen, Group, Image, Italic, LayoutTemplate, List, ListOrdered, Maximize,
  MessageSquare, Monitor, Palette, PanelLeft, Play, Plus, Printer, Save, Scissors,
  SendToBack, Shapes, Square, Table2, TextAlignCenter, TextAlignEnd, TextAlignStart,
  TextCursorInput, Timer, Trash2, Type, Underline, Ungroup, X,
  type LucideIcon,
} from "lucide-react";

/** Icons for the ten deck tabs. Command data stays in `deckCommands.ts`; this
 * map is split out only to keep both files readable. */
export const DECK_ICONS: Record<string, LucideIcon> = {
  alignCenter: TextAlignCenter, alignLeft: TextAlignStart, alignRight: TextAlignEnd, bold: Bold,
  bringFront: BringToFront, bullets: List, chart: ChartColumn, copy: Copy, cut: Scissors,
  deleteComment: Trash2, deleteSlide: Trash2, duplicateSlide: Copy, exportImages: FileImage,
  exportPdf: FileText, fit: Maximize, font: Type, group: Group, hideSlide: Monitor,
  image: Image, italic: Italic, layout: LayoutTemplate, master: LayoutTemplate,
  new: FilePlus, newSlide: Plus, numbering: ListOrdered, paste: Copy, picture: Image,
  print: Printer, properties: FileText, save: Save, saveCopy: Save, sendBack: SendToBack,
  shape: Shapes, size: Type, slideSize: Maximize, table: Table2, textBox: TextCursorInput,
  textColor: Palette, theme: Palette, transition: Play, animation: Play, timer: Timer,
  underline: Underline, ungroup: Ungroup, close: X, present: Monitor, panel: PanelLeft,
  comment: MessageSquare, limits: FileText, shortcuts: FileText, help: FileText,
  zoom: Maximize, notes: FileText, normal: Square, slideSorter: LayoutTemplate,
  masterView: LayoutTemplate, compatibility: FileText, presenterView: Monitor,
  chooseDisplay: Monitor, fromBeginning: Play, fromCurrent: Play, advanceAfter: Timer,
  advanceClick: Play, applyTransitionAll: Play, transitionDuration: Timer,
  animationStart: Play, animationDuration: Timer, animationDelay: Timer,
  removeAnimation: Trash2, animationPane: PanelLeft,
  styleLibrary: Brush, importStyle: FolderOpen, exportStyle: Download,
};
