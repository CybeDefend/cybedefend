/**
 * Central icon registry — the single place icons enter the app.
 *
 * Components import from here, never from a vendor directly; the test next door
 * enforces it. Two vendors draw the set, as they always did: FontAwesome for the
 * solid glyphs, lucide for the stroked ones. Each name below goes back to the
 * vendor that name came from, so a call site renders the icon it has always
 * rendered — and the vendor spellings kept as separate entries (`Times` next to
 * `X`, `AngleDown` next to `ChevronDown`) are what records which one that is.
 *
 * The vendors disagreed on API, not on artwork. Both are wrapped into one prop
 * contract and one `cybe-icon-*` class by ./iconFactory, which is what keeps a
 * change of vendor invisible to the ~235 files importing from here.
 *
 * FontAwesome is imported one glyph per module rather than through the package
 * barrel: the barrel is a megabyte of definitions, and every file that pulls in
 * an icon would pull in all of it on the dev server and in the test runner.
 *
 * Brand marks (npm, PyPI, Java, GitLab…) stay on react-icons on purpose: they
 * are trademarks and must remain recognisable, so they are not drawn here.
 */

import { faAngleDown } from '@fortawesome/free-solid-svg-icons/faAngleDown';
import { faAngleLeft } from '@fortawesome/free-solid-svg-icons/faAngleLeft';
import { faAngleRight } from '@fortawesome/free-solid-svg-icons/faAngleRight';
import { faAngleUp } from '@fortawesome/free-solid-svg-icons/faAngleUp';
import { faArchive } from '@fortawesome/free-solid-svg-icons/faArchive';
import { faArrowDown } from '@fortawesome/free-solid-svg-icons/faArrowDown';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons/faArrowLeft';
import { faArrowRight } from '@fortawesome/free-solid-svg-icons/faArrowRight';
import { faArrowUp } from '@fortawesome/free-solid-svg-icons/faArrowUp';
import { faBan } from '@fortawesome/free-solid-svg-icons/faBan';
import { faBars } from '@fortawesome/free-solid-svg-icons/faBars';
import { faBell } from '@fortawesome/free-solid-svg-icons/faBell';
import { faBook } from '@fortawesome/free-solid-svg-icons/faBook';
import { faBox } from '@fortawesome/free-solid-svg-icons/faBox';
import { faBoxOpen } from '@fortawesome/free-solid-svg-icons/faBoxOpen';
import { faBug } from '@fortawesome/free-solid-svg-icons/faBug';
import { faBuilding } from '@fortawesome/free-solid-svg-icons/faBuilding';
import { faCalendar } from '@fortawesome/free-solid-svg-icons/faCalendar';
import { faCalendarAlt } from '@fortawesome/free-solid-svg-icons/faCalendarAlt';
import { faChartBar } from '@fortawesome/free-solid-svg-icons/faChartBar';
import { faChartLine } from '@fortawesome/free-solid-svg-icons/faChartLine';
import { faChartPie } from '@fortawesome/free-solid-svg-icons/faChartPie';
import { faCheck } from '@fortawesome/free-solid-svg-icons/faCheck';
import { faCheckCircle } from '@fortawesome/free-solid-svg-icons/faCheckCircle';
import { faCheckSquare } from '@fortawesome/free-solid-svg-icons/faCheckSquare';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons/faChevronDown';
import { faChevronLeft } from '@fortawesome/free-solid-svg-icons/faChevronLeft';
import { faChevronRight } from '@fortawesome/free-solid-svg-icons/faChevronRight';
import { faChevronUp } from '@fortawesome/free-solid-svg-icons/faChevronUp';
import { faCircle } from '@fortawesome/free-solid-svg-icons/faCircle';
import { faCircleCheck } from '@fortawesome/free-solid-svg-icons/faCircleCheck';
import { faCircleInfo } from '@fortawesome/free-solid-svg-icons/faCircleInfo';
import { faClipboard } from '@fortawesome/free-solid-svg-icons/faClipboard';
import { faClipboardCheck } from '@fortawesome/free-solid-svg-icons/faClipboardCheck';
import { faClipboardList } from '@fortawesome/free-solid-svg-icons/faClipboardList';
import { faClock } from '@fortawesome/free-solid-svg-icons/faClock';
import { faCode } from '@fortawesome/free-solid-svg-icons/faCode';
import { faCodeBranch } from '@fortawesome/free-solid-svg-icons/faCodeBranch';
import { faCog } from '@fortawesome/free-solid-svg-icons/faCog';
import { faCogs } from '@fortawesome/free-solid-svg-icons/faCogs';
import { faCommentDots } from '@fortawesome/free-solid-svg-icons/faCommentDots';
import { faComments } from '@fortawesome/free-solid-svg-icons/faComments';
import { faCopy } from '@fortawesome/free-solid-svg-icons/faCopy';
import { faCreditCard } from '@fortawesome/free-solid-svg-icons/faCreditCard';
import { faCube } from '@fortawesome/free-solid-svg-icons/faCube';
import { faCubes } from '@fortawesome/free-solid-svg-icons/faCubes';
import { faDownload } from '@fortawesome/free-solid-svg-icons/faDownload';
import { faEdit } from '@fortawesome/free-solid-svg-icons/faEdit';
import { faEllipsisH } from '@fortawesome/free-solid-svg-icons/faEllipsisH';
import { faExclamation } from '@fortawesome/free-solid-svg-icons/faExclamation';
import { faExclamationCircle } from '@fortawesome/free-solid-svg-icons/faExclamationCircle';
import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons/faExclamationTriangle';
import { faExternalLink } from '@fortawesome/free-solid-svg-icons/faExternalLink';
import { faExternalLinkAlt } from '@fortawesome/free-solid-svg-icons/faExternalLinkAlt';
import { faEye } from '@fortawesome/free-solid-svg-icons/faEye';
import { faEyeSlash } from '@fortawesome/free-solid-svg-icons/faEyeSlash';
import { faFile } from '@fortawesome/free-solid-svg-icons/faFile';
import { faFileAlt } from '@fortawesome/free-solid-svg-icons/faFileAlt';
import { faFileCode } from '@fortawesome/free-solid-svg-icons/faFileCode';
import { faFileContract } from '@fortawesome/free-solid-svg-icons/faFileContract';
import { faFileExport } from '@fortawesome/free-solid-svg-icons/faFileExport';
import { faFileImport } from '@fortawesome/free-solid-svg-icons/faFileImport';
import { faFileLines } from '@fortawesome/free-solid-svg-icons/faFileLines';
import { faFilePdf } from '@fortawesome/free-solid-svg-icons/faFilePdf';
import { faFileZipper } from '@fortawesome/free-solid-svg-icons/faFileZipper';
import { faFilter } from '@fortawesome/free-solid-svg-icons/faFilter';
import { faFolderOpen } from '@fortawesome/free-solid-svg-icons/faFolderOpen';
import { faFolderTree } from '@fortawesome/free-solid-svg-icons/faFolderTree';
import { faGavel } from '@fortawesome/free-solid-svg-icons/faGavel';
import { faGithub } from '@fortawesome/free-brands-svg-icons/faGithub';
import { faDiscord } from '@fortawesome/free-brands-svg-icons/faDiscord';
import { faHeadset } from '@fortawesome/free-solid-svg-icons/faHeadset';
import { faHistory } from '@fortawesome/free-solid-svg-icons/faHistory';
import { faHome } from '@fortawesome/free-solid-svg-icons/faHome';
import { faHourglass } from '@fortawesome/free-solid-svg-icons/faHourglass';
import { faImage } from '@fortawesome/free-solid-svg-icons/faImage';
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons/faInfoCircle';
import { faKey } from '@fortawesome/free-solid-svg-icons/faKey';
import { faLayerGroup } from '@fortawesome/free-solid-svg-icons/faLayerGroup';
import { faLightbulb } from '@fortawesome/free-solid-svg-icons/faLightbulb';
import { faLink } from '@fortawesome/free-solid-svg-icons/faLink';
import { faListAlt } from '@fortawesome/free-solid-svg-icons/faListAlt';
import { faListCheck } from '@fortawesome/free-solid-svg-icons/faListCheck';
import { faListUl } from '@fortawesome/free-solid-svg-icons/faListUl';
import { faLock } from '@fortawesome/free-solid-svg-icons/faLock';
import { faMagicWandSparkles } from '@fortawesome/free-solid-svg-icons/faMagicWandSparkles';
import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons/faMagnifyingGlass';
import { faMapSigns } from '@fortawesome/free-solid-svg-icons/faMapSigns';
import { faMedal } from '@fortawesome/free-solid-svg-icons/faMedal';
import { faMinusCircle } from '@fortawesome/free-solid-svg-icons/faMinusCircle';
import { faMousePointer } from '@fortawesome/free-solid-svg-icons/faMousePointer';
import { faPen } from '@fortawesome/free-solid-svg-icons/faPen';
import { faPercent } from '@fortawesome/free-solid-svg-icons/faPercent';
import { faPieChart } from '@fortawesome/free-solid-svg-icons/faPieChart';
import { faPlug } from '@fortawesome/free-solid-svg-icons/faPlug';
import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus';
import { faProjectDiagram } from '@fortawesome/free-solid-svg-icons/faProjectDiagram';
import { faPuzzlePiece } from '@fortawesome/free-solid-svg-icons/faPuzzlePiece';
import { faQuestionCircle } from '@fortawesome/free-solid-svg-icons/faQuestionCircle';
import { faRefresh } from '@fortawesome/free-solid-svg-icons/faRefresh';
import { faRotate } from '@fortawesome/free-solid-svg-icons/faRotate';
import { faRotateRight } from '@fortawesome/free-solid-svg-icons/faRotateRight';
import { faSave } from '@fortawesome/free-solid-svg-icons/faSave';
import { faSearch } from '@fortawesome/free-solid-svg-icons/faSearch';
import { faServer } from '@fortawesome/free-solid-svg-icons/faServer';
import { faShieldAlt } from '@fortawesome/free-solid-svg-icons/faShieldAlt';
import { faShieldHalved } from '@fortawesome/free-solid-svg-icons/faShieldHalved';
import { faSignOutAlt } from '@fortawesome/free-solid-svg-icons/faSignOutAlt';
import { faSitemap } from '@fortawesome/free-solid-svg-icons/faSitemap';
import { faSpinner } from '@fortawesome/free-solid-svg-icons/faSpinner';
import { faSquare } from '@fortawesome/free-solid-svg-icons/faSquare';
import { faSquarePlus } from '@fortawesome/free-solid-svg-icons/faSquarePlus';
import { faStar } from '@fortawesome/free-solid-svg-icons/faStar';
import { faSync } from '@fortawesome/free-solid-svg-icons/faSync';
import { faSyncAlt } from '@fortawesome/free-solid-svg-icons/faSyncAlt';
import { faTag } from '@fortawesome/free-solid-svg-icons/faTag';
import { faTerminal } from '@fortawesome/free-solid-svg-icons/faTerminal';
import { faTicket } from '@fortawesome/free-solid-svg-icons/faTicket';
import { faTimes } from '@fortawesome/free-solid-svg-icons/faTimes';
import { faTimesCircle } from '@fortawesome/free-solid-svg-icons/faTimesCircle';
import { faToggleOff } from '@fortawesome/free-solid-svg-icons/faToggleOff';
import { faToggleOn } from '@fortawesome/free-solid-svg-icons/faToggleOn';
import { faTools } from '@fortawesome/free-solid-svg-icons/faTools';
import { faTrash } from '@fortawesome/free-solid-svg-icons/faTrash';
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons/faTriangleExclamation';
import { faTrophy } from '@fortawesome/free-solid-svg-icons/faTrophy';
import { faUser } from '@fortawesome/free-solid-svg-icons/faUser';
import { faUserCheck } from '@fortawesome/free-solid-svg-icons/faUserCheck';
import { faUserGear } from '@fortawesome/free-solid-svg-icons/faUserGear';
import { faUsers } from '@fortawesome/free-solid-svg-icons/faUsers';
import { faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons/faWandMagicSparkles';
import { faWrench } from '@fortawesome/free-solid-svg-icons/faWrench';
import { faXmark } from '@fortawesome/free-solid-svg-icons/faXmark';
import {
  Activity as LucideActivity,
  AlertCircle as LucideAlertCircle,
  AlertTriangle as LucideAlertTriangle,
  AppWindow as LucideAppWindow,
  BarChart3 as LucideBarChart3,
  BookOpen as LucideBookOpen,
  Bot as LucideBot,
  BotMessageSquare as LucideBotMessageSquare,
  Braces as LucideBraces,
  Brain as LucideBrain,
  Building2 as LucideBuilding2,
  Calculator as LucideCalculator,
  CheckCircle2 as LucideCheckCircle2,
  ChevronsUpDown as LucideChevronsUpDown,
  Code2 as LucideCode2,
  Container as LucideContainer,
  Cpu as LucideCpu,
  Crosshair as LucideCrosshair,
  Database as LucideDatabase,
  Edit3 as LucideEdit3,
  Equal as LucideEqual,
  Expand as LucideExpand,
  EyeOff as LucideEyeOff,
  FileBarChart as LucideFileBarChart,
  FileJson as LucideFileJson,
  FileText as LucideFileText,
  Flame as LucideFlame,
  FlaskConical as LucideFlaskConical,
  Folder as LucideFolder,
  GitBranch as LucideGitBranch,
  GitCommitHorizontal as LucideGitCommitHorizontal,
  GitPullRequestArrow as LucideGitPullRequestArrow,
  Globe as LucideGlobe,
  Grid3X3 as LucideGrid3X3,
  HardDrive as LucideHardDrive,
  HelpCircle as LucideHelpCircle,
  HourglassIcon as LucideHourglassIcon,
  House as LucideHouse,
  Images as LucideImages,
  Inbox as LucideInbox,
  Info as LucideInfo,
  Keyboard as LucideKeyboard,
  KeyRound as LucideKeyRound,
  Layers as LucideLayers,
  Library as LucideLibrary,
  Link2 as LucideLink2,
  List as LucideList,
  Loader2 as LucideLoader2,
  Mail as LucideMail,
  Maximize2 as LucideMaximize2,
  Microchip as LucideMicrochip,
  Minimize2 as LucideMinimize2,
  Minus as LucideMinus,
  Monitor as LucideMonitor,
  Moon as LucideMoon,
  Network as LucideNetwork,
  Orbit as LucideOrbit,
  Package as LucidePackage,
  PackageCheck as LucidePackageCheck,
  PackageX as LucidePackageX,
  Pause as LucidePause,
  Pencil as LucidePencil,
  Pin as LucidePin,
  Play as LucidePlay,
  PlusCircle as LucidePlusCircle,
  Radar as LucideRadar,
  RefreshCw as LucideRefreshCw,
  Rocket as LucideRocket,
  Satellite as LucideSatellite,
  Scale as LucideScale,
  Settings as LucideSettings,
  Settings2 as LucideSettings2,
  Shield as LucideShield,
  ShieldAlert as LucideShieldAlert,
  ShieldCheck as LucideShieldCheck,
  ShieldX as LucideShieldX,
  Smartphone as LucideSmartphone,
  SortAsc as LucideSortAsc,
  Sparkles as LucideSparkles,
  Sun as LucideSun,
  Target as LucideTarget,
  ThumbsDown as LucideThumbsDown,
  ThumbsUp as LucideThumbsUp,
  Trash2 as LucideTrash2,
  TrendingUp as LucideTrendingUp,
  Upload as LucideUpload,
  UserCircle as LucideUserCircle,
  UserCircle2 as LucideUserCircle2,
  UserPlus as LucideUserPlus,
  X as LucideX,
  XCircle as LucideXCircle,
  Zap as LucideZap,
  ZoomIn as LucideZoomIn,
  ZoomOut as LucideZoomOut,
} from 'lucide-react';

import { createFaIcon, createLucideIcon } from './iconFactory';

export type { IconProps } from './iconFactory';

// Solid glyphs — drawn by FontAwesome.
export const Alert = createFaIcon('Alert', faExclamation);
export const AngleDown = createFaIcon('AngleDown', faAngleDown);
export const AngleLeft = createFaIcon('AngleLeft', faAngleLeft);
export const AngleRight = createFaIcon('AngleRight', faAngleRight);
export const AngleUp = createFaIcon('AngleUp', faAngleUp);
export const Archive = createFaIcon('Archive', faArchive);
export const ArrowDown = createFaIcon('ArrowDown', faArrowDown);
export const ArrowLeft = createFaIcon('ArrowLeft', faArrowLeft);
export const ArrowRight = createFaIcon('ArrowRight', faArrowRight);
export const ArrowUp = createFaIcon('ArrowUp', faArrowUp);
export const Ban = createFaIcon('Ban', faBan);
export const Bars = createFaIcon('Bars', faBars);
export const Bell = createFaIcon('Bell', faBell);
export const Book = createFaIcon('Book', faBook);
export const Box = createFaIcon('Box', faBox);
export const BoxOpen = createFaIcon('BoxOpen', faBoxOpen);
export const Bug = createFaIcon('Bug', faBug);
export const Building = createFaIcon('Building', faBuilding);
export const Calendar = createFaIcon('Calendar', faCalendar);
export const CalendarAlt = createFaIcon('CalendarAlt', faCalendarAlt);
export const ChartBar = createFaIcon('ChartBar', faChartBar);
export const ChartLine = createFaIcon('ChartLine', faChartLine);
export const ChartPie = createFaIcon('ChartPie', faChartPie);
export const Check = createFaIcon('Check', faCheck);
export const CheckCircle = createFaIcon('CheckCircle', faCheckCircle);
export const CheckSquare = createFaIcon('CheckSquare', faCheckSquare);
export const ChevronDown = createFaIcon('ChevronDown', faChevronDown);
export const ChevronLeft = createFaIcon('ChevronLeft', faChevronLeft);
export const ChevronRight = createFaIcon('ChevronRight', faChevronRight);
export const ChevronUp = createFaIcon('ChevronUp', faChevronUp);
export const Circle = createFaIcon('Circle', faCircle);
export const CircleCheck = createFaIcon('CircleCheck', faCircleCheck);
export const CircleInfo = createFaIcon('CircleInfo', faCircleInfo);
export const Clipboard = createFaIcon('Clipboard', faClipboard);
export const ClipboardCheck = createFaIcon('ClipboardCheck', faClipboardCheck);
export const ClipboardList = createFaIcon('ClipboardList', faClipboardList);
export const Clock = createFaIcon('Clock', faClock);
export const Close = createFaIcon('Close', faXmark);
export const CloseCircle = createFaIcon('CloseCircle', faTimesCircle);
export const Code = createFaIcon('Code', faCode);
export const CodeBranch = createFaIcon('CodeBranch', faCodeBranch);
export const Cog = createFaIcon('Cog', faCog);
export const Cogs = createFaIcon('Cogs', faCogs);
export const CommentDots = createFaIcon('CommentDots', faCommentDots);
export const Comments = createFaIcon('Comments', faComments);
export const Copy = createFaIcon('Copy', faCopy);
export const CreditCard = createFaIcon('CreditCard', faCreditCard);
export const Cube = createFaIcon('Cube', faCube);
export const Cubes = createFaIcon('Cubes', faCubes);
export const Download = createFaIcon('Download', faDownload);
export const Edit = createFaIcon('Edit', faEdit);
export const EllipsisH = createFaIcon('EllipsisH', faEllipsisH);
export const Exclamation = createFaIcon('Exclamation', faExclamation);
export const ExclamationCircle = createFaIcon('ExclamationCircle', faExclamationCircle);
export const ExclamationTriangle = createFaIcon('ExclamationTriangle', faExclamationTriangle);
export const ExternalLink = createFaIcon('ExternalLink', faExternalLink);
export const ExternalLinkAlt = createFaIcon('ExternalLinkAlt', faExternalLinkAlt);
export const Eye = createFaIcon('Eye', faEye);
export const EyeSlash = createFaIcon('EyeSlash', faEyeSlash);
export const File = createFaIcon('File', faFile);
export const FileAlt = createFaIcon('FileAlt', faFileAlt);
export const FileCode = createFaIcon('FileCode', faFileCode);
export const FileContract = createFaIcon('FileContract', faFileContract);
export const FileExport = createFaIcon('FileExport', faFileExport);
export const FileImport = createFaIcon('FileImport', faFileImport);
export const FileLines = createFaIcon('FileLines', faFileLines);
export const FilePdf = createFaIcon('FilePdf', faFilePdf);
export const FileZipper = createFaIcon('FileZipper', faFileZipper);
export const Filter = createFaIcon('Filter', faFilter);
export const FolderOpen = createFaIcon('FolderOpen', faFolderOpen);
export const FolderTree = createFaIcon('FolderTree', faFolderTree);
export const Gavel = createFaIcon('Gavel', faGavel);
export const Github = createFaIcon('Github', faGithub);
export const Discord = createFaIcon('Discord', faDiscord);
export const Headset = createFaIcon('Headset', faHeadset);
export const History = createFaIcon('History', faHistory);
export const Home = createFaIcon('Home', faHome);
export const Hourglass = createFaIcon('Hourglass', faHourglass);
export const Image = createFaIcon('Image', faImage);
export const InfoCircle = createFaIcon('InfoCircle', faInfoCircle);
export const Key = createFaIcon('Key', faKey);
export const LayerGroup = createFaIcon('LayerGroup', faLayerGroup);
export const Lightbulb = createFaIcon('Lightbulb', faLightbulb);
export const Link = createFaIcon('Link', faLink);
export const ListAlt = createFaIcon('ListAlt', faListAlt);
export const ListCheck = createFaIcon('ListCheck', faListCheck);
export const ListUl = createFaIcon('ListUl', faListUl);
export const Lock = createFaIcon('Lock', faLock);
export const MagicWandSparkles = createFaIcon('MagicWandSparkles', faMagicWandSparkles);
export const MagnifyingGlass = createFaIcon('MagnifyingGlass', faMagnifyingGlass);
export const MapSigns = createFaIcon('MapSigns', faMapSigns);
export const Medal = createFaIcon('Medal', faMedal);
export const Menu = createFaIcon('Menu', faBars);
export const MessageCircle = createFaIcon('MessageCircle', faCommentDots);
export const MessageSquare = createFaIcon('MessageSquare', faComments);
export const MinusCircle = createFaIcon('MinusCircle', faMinusCircle);
export const MoreHorizontal = createFaIcon('MoreHorizontal', faEllipsisH);
export const MousePointer = createFaIcon('MousePointer', faMousePointer);
export const Pen = createFaIcon('Pen', faPen);
export const Percent = createFaIcon('Percent', faPercent);
export const PieChart = createFaIcon('PieChart', faPieChart);
export const Plug = createFaIcon('Plug', faPlug);
export const Plus = createFaIcon('Plus', faPlus);
export const PlusSquare = createFaIcon('PlusSquare', faSquarePlus);
export const ProjectDiagram = createFaIcon('ProjectDiagram', faProjectDiagram);
export const PuzzlePiece = createFaIcon('PuzzlePiece', faPuzzlePiece);
export const QuestionCircle = createFaIcon('QuestionCircle', faQuestionCircle);
export const Refresh = createFaIcon('Refresh', faRefresh);
export const Rotate = createFaIcon('Rotate', faRotate);
export const RotateRight = createFaIcon('RotateRight', faRotateRight);
export const Save = createFaIcon('Save', faSave);
export const Search = createFaIcon('Search', faSearch);
export const Server = createFaIcon('Server', faServer);
export const ShieldAlt = createFaIcon('ShieldAlt', faShieldAlt);
export const ShieldHalved = createFaIcon('ShieldHalved', faShieldHalved);
export const SignOut = createFaIcon('SignOut', faSignOutAlt);
export const SignOutAlt = createFaIcon('SignOutAlt', faSignOutAlt);
export const Sitemap = createFaIcon('Sitemap', faSitemap);
export const Spinner = createFaIcon('Spinner', faSpinner);
export const Square = createFaIcon('Square', faSquare);
export const SquarePlus = createFaIcon('SquarePlus', faSquarePlus);
export const Star = createFaIcon('Star', faStar);
export const Sync = createFaIcon('Sync', faSync);
export const SyncAlt = createFaIcon('SyncAlt', faSyncAlt);
export const Tag = createFaIcon('Tag', faTag);
export const Terminal = createFaIcon('Terminal', faTerminal);
export const Ticket = createFaIcon('Ticket', faTicket);
export const Times = createFaIcon('Times', faTimes);
export const TimesCircle = createFaIcon('TimesCircle', faTimesCircle);
export const ToggleOff = createFaIcon('ToggleOff', faToggleOff);
export const ToggleOn = createFaIcon('ToggleOn', faToggleOn);
export const Tools = createFaIcon('Tools', faTools);
export const Trash = createFaIcon('Trash', faTrash);
export const TriangleExclamation = createFaIcon('TriangleExclamation', faTriangleExclamation);
export const Trophy = createFaIcon('Trophy', faTrophy);
export const User = createFaIcon('User', faUser);
export const UserCheck = createFaIcon('UserCheck', faUserCheck);
export const UserGear = createFaIcon('UserGear', faUserGear);
export const Users = createFaIcon('Users', faUsers);
export const WandMagicSparkles = createFaIcon('WandMagicSparkles', faWandMagicSparkles);
export const Wrench = createFaIcon('Wrench', faWrench);
export const Xmark = createFaIcon('Xmark', faXmark);

// Stroked glyphs — drawn by lucide.
export const Activity = createLucideIcon('Activity', LucideActivity);
export const AlertCircle = createLucideIcon('AlertCircle', LucideAlertCircle);
export const AlertTriangle = createLucideIcon('AlertTriangle', LucideAlertTriangle);
export const AppWindow = createLucideIcon('AppWindow', LucideAppWindow);
export const BarChart3 = createLucideIcon('BarChart3', LucideBarChart3);
export const BookOpen = createLucideIcon('BookOpen', LucideBookOpen);
export const Bot = createLucideIcon('Bot', LucideBot);
export const BotMessageSquare = createLucideIcon('BotMessageSquare', LucideBotMessageSquare);
export const Braces = createLucideIcon('Braces', LucideBraces);
export const Brain = createLucideIcon('Brain', LucideBrain);
export const Building2 = createLucideIcon('Building2', LucideBuilding2);
export const Calculator = createLucideIcon('Calculator', LucideCalculator);
export const CheckCircle2 = createLucideIcon('CheckCircle2', LucideCheckCircle2);
export const ChevronsUpDown = createLucideIcon('ChevronsUpDown', LucideChevronsUpDown);
export const Code2 = createLucideIcon('Code2', LucideCode2);
export const Container = createLucideIcon('Container', LucideContainer);
export const Cpu = createLucideIcon('Cpu', LucideCpu);
export const Crosshair = createLucideIcon('Crosshair', LucideCrosshair);
export const Database = createLucideIcon('Database', LucideDatabase);
export const Edit3 = createLucideIcon('Edit3', LucideEdit3);
export const Equal = createLucideIcon('Equal', LucideEqual);
export const Expand = createLucideIcon('Expand', LucideExpand);
export const EyeOff = createLucideIcon('EyeOff', LucideEyeOff);
export const FileBarChart = createLucideIcon('FileBarChart', LucideFileBarChart);
export const FileJson = createLucideIcon('FileJson', LucideFileJson);
export const FileText = createLucideIcon('FileText', LucideFileText);
export const Flame = createLucideIcon('Flame', LucideFlame);
export const FlaskConical = createLucideIcon('FlaskConical', LucideFlaskConical);
export const Folder = createLucideIcon('Folder', LucideFolder);
export const GitBranch = createLucideIcon('GitBranch', LucideGitBranch);
export const GitCommitHorizontal = createLucideIcon('GitCommitHorizontal', LucideGitCommitHorizontal);
export const GitPullRequestArrow = createLucideIcon('GitPullRequestArrow', LucideGitPullRequestArrow);
export const Globe = createLucideIcon('Globe', LucideGlobe);
export const Grid = createLucideIcon('Grid', LucideGrid3X3);
export const Grid3X3 = createLucideIcon('Grid3X3', LucideGrid3X3);
export const HardDrive = createLucideIcon('HardDrive', LucideHardDrive);
export const HelpCircle = createLucideIcon('HelpCircle', LucideHelpCircle);
export const HourglassIcon = createLucideIcon('HourglassIcon', LucideHourglassIcon);
export const House = createLucideIcon('House', LucideHouse);
export const Images = createLucideIcon('Images', LucideImages);
export const Inbox = createLucideIcon('Inbox', LucideInbox);
export const Info = createLucideIcon('Info', LucideInfo);
export const KeyRound = createLucideIcon('KeyRound', LucideKeyRound);
export const Keyboard = createLucideIcon('Keyboard', LucideKeyboard);
export const Layers = createLucideIcon('Layers', LucideLayers);
export const Library = createLucideIcon('Library', LucideLibrary);
export const Link2 = createLucideIcon('Link2', LucideLink2);
export const List = createLucideIcon('List', LucideList);
export const Loader2 = createLucideIcon('Loader2', LucideLoader2);
export const Mail = createLucideIcon('Mail', LucideMail);
export const Maximize2 = createLucideIcon('Maximize2', LucideMaximize2);
export const Microchip = createLucideIcon('Microchip', LucideMicrochip);
export const Minimize2 = createLucideIcon('Minimize2', LucideMinimize2);
export const Minus = createLucideIcon('Minus', LucideMinus);
export const Monitor = createLucideIcon('Monitor', LucideMonitor);
export const Moon = createLucideIcon('Moon', LucideMoon);
export const Network = createLucideIcon('Network', LucideNetwork);
export const Orbit = createLucideIcon('Orbit', LucideOrbit);
export const Package = createLucideIcon('Package', LucidePackage);
export const PackageCheck = createLucideIcon('PackageCheck', LucidePackageCheck);
export const PackageX = createLucideIcon('PackageX', LucidePackageX);
export const Pause = createLucideIcon('Pause', LucidePause);
export const Pencil = createLucideIcon('Pencil', LucidePencil);
export const Pin = createLucideIcon('Pin', LucidePin);
export const Play = createLucideIcon('Play', LucidePlay);
export const PlusCircle = createLucideIcon('PlusCircle', LucidePlusCircle);
export const Radar = createLucideIcon('Radar', LucideRadar);
export const RefreshCw = createLucideIcon('RefreshCw', LucideRefreshCw);
export const Rocket = createLucideIcon('Rocket', LucideRocket);
export const Satellite = createLucideIcon('Satellite', LucideSatellite);
export const Scale = createLucideIcon('Scale', LucideScale);
export const Settings = createLucideIcon('Settings', LucideSettings);
export const Settings2 = createLucideIcon('Settings2', LucideSettings2);
export const Shield = createLucideIcon('Shield', LucideShield);
export const ShieldAlert = createLucideIcon('ShieldAlert', LucideShieldAlert);
export const ShieldCheck = createLucideIcon('ShieldCheck', LucideShieldCheck);
export const ShieldX = createLucideIcon('ShieldX', LucideShieldX);
export const Smartphone = createLucideIcon('Smartphone', LucideSmartphone);
export const SortAsc = createLucideIcon('SortAsc', LucideSortAsc);
export const Sparkles = createLucideIcon('Sparkles', LucideSparkles);
export const Sun = createLucideIcon('Sun', LucideSun);
export const Target = createLucideIcon('Target', LucideTarget);
export const ThumbsDown = createLucideIcon('ThumbsDown', LucideThumbsDown);
export const ThumbsUp = createLucideIcon('ThumbsUp', LucideThumbsUp);
export const Trash2 = createLucideIcon('Trash2', LucideTrash2);
export const TrendingUp = createLucideIcon('TrendingUp', LucideTrendingUp);
export const Upload = createLucideIcon('Upload', LucideUpload);
export const UserCircle = createLucideIcon('UserCircle', LucideUserCircle);
export const UserCircle2 = createLucideIcon('UserCircle2', LucideUserCircle2);
export const UserPlus = createLucideIcon('UserPlus', LucideUserPlus);
export const X = createLucideIcon('X', LucideX);
export const XCircle = createLucideIcon('XCircle', LucideXCircle);
export const Zap = createLucideIcon('Zap', LucideZap);
export const ZoomIn = createLucideIcon('ZoomIn', LucideZoomIn);
export const ZoomOut = createLucideIcon('ZoomOut', LucideZoomOut);
