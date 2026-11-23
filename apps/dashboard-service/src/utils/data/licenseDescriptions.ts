export interface LicenseDescription {
  name: string;
  description: {
    en: string;
    fr: string;
  };
  legalRisks: {
    en: string[];
    fr: string[];
  };
  obligations: {
    en: string[];
    fr: string[];
  };
  recommendations: {
    en: string[];
    fr: string[];
  };
  url: string;
}

const licenseDescriptions: Record<string, LicenseDescription> = {
  MIT: {
    name: 'MIT License',
    description: {
      en: 'A short and simple permissive license with conditions only requiring preservation of copyright and license notices. Licensed works, modifications, and larger works may be distributed under different terms and without source code.',
      fr: "Une licence permissive courte et simple dont les conditions ne requièrent que la préservation des avis de copyright et de licence. Les travaux sous licence, modifications et travaux plus larges peuvent être distribués sous des termes différents et sans code source.",
    },
    legalRisks: {
      en: [
        'No patent grant: contributors do not explicitly license their patents, leaving potential exposure to patent claims.',
        'No trademark rights: the license does not address trademark usage.',
        'Provided "as is" without warranty: no legal recourse if the software causes damage.',
      ],
      fr: [
        "Aucune concession de brevet : les contributeurs ne concèdent pas explicitement leurs brevets, laissant une exposition potentielle aux revendications de brevets.",
        "Aucun droit de marque : la licence ne traite pas de l'utilisation des marques.",
        "Fourni « en l'état » sans garantie : aucun recours juridique si le logiciel cause des dommages.",
      ],
    },
    obligations: {
      en: ['Include copyright notice and license text in all copies or substantial portions.'],
      fr: ["Inclure l'avis de copyright et le texte de la licence dans toutes les copies ou portions substantielles."],
    },
    recommendations: {
      en: [
        'Keep a copy of the LICENSE file in your project and in all distributed artifacts.',
        'Safe for commercial and proprietary use without additional legal review.',
      ],
      fr: [
        'Conserver une copie du fichier LICENSE dans votre projet et dans tous les artefacts distribués.',
        'Utilisation commerciale et propriétaire sans examen juridique supplémentaire.',
      ],
    },
    url: 'https://spdx.org/licenses/MIT.html',
  },
  ISC: {
    name: 'ISC License',
    description: {
      en: 'A permissive license functionally equivalent to the BSD 2-Clause and MIT licenses, removing some language that is no longer necessary.',
      fr: 'Une licence permissive fonctionnellement équivalente aux licences BSD 2-Clause et MIT, supprimant certains termes devenus inutiles.',
    },
    legalRisks: {
      en: [
        'No patent grant: same exposure as MIT regarding patent claims.',
        'Provided "as is" without warranty: no liability protection for users.',
      ],
      fr: [
        'Aucune concession de brevet : même exposition que la MIT concernant les revendications de brevets.',
        "Fourni « en l'état » sans garantie : aucune protection en responsabilité pour les utilisateurs.",
      ],
    },
    obligations: {
      en: ['Include copyright notice and license text.'],
      fr: ["Inclure l'avis de copyright et le texte de la licence."],
    },
    recommendations: {
      en: [
        'Treat identically to MIT: include the license text in distributions.',
        'Safe for commercial and proprietary use.',
      ],
      fr: [
        'Traiter de manière identique à MIT : inclure le texte de la licence dans les distributions.',
        'Utilisation commerciale et propriétaire sans restriction.',
      ],
    },
    url: 'https://spdx.org/licenses/ISC.html',
  },
  'Apache-2.0': {
    name: 'Apache License 2.0',
    description: {
      en: 'A permissive license that also provides an express grant of patent rights from contributors to users. It requires preservation of copyright and license notices.',
      fr: "Une licence permissive qui fournit également une concession expresse de droits de brevet des contributeurs aux utilisateurs. Elle exige la préservation des avis de copyright et de licence.",
    },
    legalRisks: {
      en: [
        'Patent retaliation clause: if you sue a contributor for patent infringement related to the software, your patent license from all contributors is automatically terminated.',
        'Trademark rights are not granted: you may not use project names or logos without permission.',
        'NOTICE file requirements can be overlooked, leading to non-compliance.',
      ],
      fr: [
        "Clause de rétorsion de brevet : si vous poursuivez un contributeur pour contrefaçon de brevet liée au logiciel, votre licence de brevet de tous les contributeurs est automatiquement résiliée.",
        "Les droits de marque ne sont pas concédés : vous ne pouvez pas utiliser les noms ou logos du projet sans permission.",
        "Les exigences du fichier NOTICE peuvent être négligées, entraînant une non-conformité.",
      ],
    },
    obligations: {
      en: [
        'Include copyright and license notice in all copies.',
        'State changes made to the code (document modifications).',
        'Include NOTICE file if one exists in the original project.',
      ],
      fr: [
        "Inclure l'avis de copyright et de licence dans toutes les copies.",
        'Indiquer les modifications apportées au code (documenter les changements).',
        "Inclure le fichier NOTICE s'il existe dans le projet original.",
      ],
    },
    recommendations: {
      en: [
        'Check for a NOTICE file in each Apache-2.0 dependency and include it in your distribution.',
        'Maintain a changelog or use version control to document modifications.',
        'Safe for commercial use: the patent grant actually provides extra protection.',
      ],
      fr: [
        'Vérifier la présence d\'un fichier NOTICE dans chaque dépendance Apache-2.0 et l\'inclure dans votre distribution.',
        'Maintenir un changelog ou utiliser le contrôle de version pour documenter les modifications.',
        'Utilisation commerciale sûre : la concession de brevet offre une protection supplémentaire.',
      ],
    },
    url: 'https://spdx.org/licenses/Apache-2.0.html',
  },
  'BSD-2-Clause': {
    name: 'BSD 2-Clause "Simplified" License',
    description: {
      en: 'A permissive license that comes in two variants: the BSD 2-Clause and BSD 3-Clause. Both have very minimal requirements on how the software can be redistributed.',
      fr: 'Une licence permissive avec des exigences minimales sur la redistribution du logiciel.',
    },
    legalRisks: {
      en: [
        'No patent grant: does not protect against patent infringement claims.',
        'Provided "as is" without warranty of any kind.',
      ],
      fr: [
        'Aucune concession de brevet : ne protège pas contre les revendications de contrefaçon de brevet.',
        "Fourni « en l'état » sans aucune garantie.",
      ],
    },
    obligations: {
      en: ['Include copyright notice and license text in source and binary distributions.'],
      fr: ["Inclure l'avis de copyright et le texte de la licence dans les distributions source et binaire."],
    },
    recommendations: {
      en: [
        'Include the license text alongside your distributed binaries and source code.',
        'Safe for commercial and proprietary use.',
      ],
      fr: [
        'Inclure le texte de la licence avec vos binaires et code source distribués.',
        'Utilisation commerciale et propriétaire sans restriction.',
      ],
    },
    url: 'https://spdx.org/licenses/BSD-2-Clause.html',
  },
  'BSD-3-Clause': {
    name: 'BSD 3-Clause "New" License',
    description: {
      en: 'Similar to the BSD 2-Clause, but includes a clause restricting the use of the names of contributors for endorsement.',
      fr: "Similaire à la BSD 2-Clause, mais inclut une clause interdisant l'utilisation des noms des contributeurs pour des recommandations.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not protect against patent claims.',
        'Non-endorsement clause: using contributor names to promote your product without permission is a license violation.',
      ],
      fr: [
        'Aucune concession de brevet : ne protège pas contre les revendications de brevet.',
        "Clause de non-recommandation : utiliser les noms des contributeurs pour promouvoir votre produit sans permission constitue une violation de licence.",
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Do not use contributor names for endorsement without written permission.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        'Ne pas utiliser les noms des contributeurs pour des recommandations sans permission écrite.',
      ],
    },
    recommendations: {
      en: [
        'Avoid referencing original authors in marketing materials unless you have explicit permission.',
        'Safe for commercial and proprietary use.',
      ],
      fr: [
        "Éviter de référencer les auteurs originaux dans les supports marketing sauf permission explicite.",
        'Utilisation commerciale et propriétaire sans restriction.',
      ],
    },
    url: 'https://spdx.org/licenses/BSD-3-Clause.html',
  },
  '0BSD': {
    name: 'BSD Zero Clause License',
    description: {
      en: 'A permissive license that is even more permissive than the MIT license: no conditions at all.',
      fr: 'Une licence permissive encore plus permissive que la licence MIT : aucune condition.',
    },
    legalRisks: {
      en: [
        'No patent grant: does not address patents.',
        'Effectively public-domain-equivalent: minimal legal risk for users.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas les brevets.",
        'Effectivement équivalent au domaine public : risque juridique minimal pour les utilisateurs.',
      ],
    },
    obligations: {
      en: ['No obligations.'],
      fr: ['Aucune obligation.'],
    },
    recommendations: {
      en: [
        'No action needed: this license imposes no requirements.',
        'Ideal for commercial and proprietary use.',
      ],
      fr: [
        "Aucune action requise : cette licence n'impose aucune exigence.",
        'Idéale pour une utilisation commerciale et propriétaire.',
      ],
    },
    url: 'https://spdx.org/licenses/0BSD.html',
  },
  Unlicense: {
    name: 'The Unlicense',
    description: {
      en: 'A template for dedicating your software to the public domain. It puts no conditions whatsoever on the use of the software.',
      fr: "Un modèle pour dédier votre logiciel au domaine public. Il ne met aucune condition sur l'utilisation du logiciel.",
    },
    legalRisks: {
      en: [
        'Public domain status is not recognized in all jurisdictions (e.g., some European countries): the fallback permissive grant may apply instead.',
        'No patent grant: does not protect against patent claims.',
      ],
      fr: [
        "Le statut de domaine public n'est pas reconnu dans toutes les juridictions (ex. certains pays européens) : la concession permissive de secours peut s'appliquer à la place.",
        'Aucune concession de brevet : ne protège pas contre les revendications de brevet.',
      ],
    },
    obligations: {
      en: ['No obligations.'],
      fr: ['Aucune obligation.'],
    },
    recommendations: {
      en: [
        'If operating in jurisdictions where public domain is uncertain, treat as a permissive license.',
        'Safe for commercial and proprietary use in most jurisdictions.',
      ],
      fr: [
        'Si vous opérez dans des juridictions où le domaine public est incertain, traitez comme une licence permissive.',
        'Utilisation commerciale et propriétaire sûre dans la plupart des juridictions.',
      ],
    },
    url: 'https://spdx.org/licenses/Unlicense.html',
  },
  'CC0-1.0': {
    name: 'Creative Commons Zero v1.0 Universal',
    description: {
      en: 'Dedicates the work to the public domain by waiving all rights under copyright law, including related and neighboring rights.',
      fr: "Dédie l'œuvre au domaine public en renonçant à tous les droits sous le droit d'auteur, y compris les droits connexes et voisins.",
    },
    legalRisks: {
      en: [
        'Public domain waiver may not be valid in all jurisdictions: CC0 includes a fallback permissive license for those cases.',
        'Does not address patents or trademarks.',
        'Designed primarily for data and content, not software: some organizations discourage its use for code.',
      ],
      fr: [
        "La renonciation au domaine public peut ne pas être valide dans toutes les juridictions : CC0 inclut une licence permissive de secours pour ces cas.",
        "N'aborde pas les brevets ni les marques.",
        "Conçue principalement pour les données et le contenu, pas le logiciel : certaines organisations déconseillent son utilisation pour le code.",
      ],
    },
    obligations: {
      en: ['No obligations.'],
      fr: ['Aucune obligation.'],
    },
    recommendations: {
      en: [
        'Safe for use with no attribution required.',
        'For software dependencies, prefer packages with MIT or Apache-2.0 if you need explicit patent protection.',
      ],
      fr: [
        'Utilisation sûre sans attribution requise.',
        "Pour les dépendances logicielles, préférer les packages sous MIT ou Apache-2.0 si vous avez besoin d'une protection explicite par brevet.",
      ],
    },
    url: 'https://spdx.org/licenses/CC0-1.0.html',
  },
  'MPL-2.0': {
    name: 'Mozilla Public License 2.0',
    description: {
      en: 'A weak copyleft license. Modifications to MPL-licensed files must remain under MPL, but the license allows combining with proprietary code in a larger work.',
      fr: 'Une licence copyleft faible. Les modifications de fichiers sous MPL doivent rester sous MPL, mais la licence permet la combinaison avec du code propriétaire dans un travail plus large.',
    },
    legalRisks: {
      en: [
        'File-level copyleft: any modifications to MPL-licensed source files must be disclosed under MPL. Failure to do so is a license violation.',
        'Patent retaliation clause: filing patent litigation related to the software terminates your license.',
        'Incompatible with some proprietary distribution models if MPL files are modified in place.',
      ],
      fr: [
        "Copyleft au niveau du fichier : toute modification de fichiers source sous MPL doit être divulguée sous MPL. Ne pas le faire constitue une violation de licence.",
        'Clause de rétorsion de brevet : engager un litige de brevet lié au logiciel résilie votre licence.',
        "Incompatible avec certains modèles de distribution propriétaire si les fichiers MPL sont modifiés en place.",
      ],
    },
    obligations: {
      en: [
        'Disclose source code of modified MPL-licensed files.',
        'Include copyright and license notices.',
        'Modifications to MPL files must stay under MPL.',
      ],
      fr: [
        'Divulguer le code source des fichiers MPL modifiés.',
        'Inclure les avis de copyright et de licence.',
        'Les modifications de fichiers MPL doivent rester sous MPL.',
      ],
    },
    recommendations: {
      en: [
        'If you do not modify the MPL-licensed files, you can use them freely in proprietary projects.',
        'If you need to modify MPL files, keep changes in separate files and publish them.',
        'Review each MPL dependency to confirm you are not modifying its source files.',
      ],
      fr: [
        'Si vous ne modifiez pas les fichiers sous MPL, vous pouvez les utiliser librement dans des projets propriétaires.',
        'Si vous devez modifier des fichiers MPL, conservez les changements dans des fichiers séparés et publiez-les.',
        "Examiner chaque dépendance MPL pour confirmer que vous ne modifiez pas ses fichiers source.",
      ],
    },
    url: 'https://spdx.org/licenses/MPL-2.0.html',
  },
  'LGPL-2.1-only': {
    name: 'GNU Lesser General Public License v2.1',
    description: {
      en: 'A weak copyleft license primarily used for software libraries. It allows linking to proprietary software, but modifications to the library itself must be open-sourced.',
      fr: "Une licence copyleft faible principalement utilisée pour les bibliothèques logicielles. Elle permet le lien avec des logiciels propriétaires, mais les modifications de la bibliothèque elle-même doivent être open-sourcées.",
    },
    legalRisks: {
      en: [
        'Static linking risk: statically linking an LGPL library into a proprietary binary may trigger copyleft obligations on the entire binary, requiring you to provide object files or source code for re-linking.',
        'Modification disclosure: if you modify the library source, you must release those modifications under LGPL.',
        'Reverse engineering clause: you must allow users to reverse-engineer your application for debugging the linked library.',
      ],
      fr: [
        "Risque de liaison statique : lier statiquement une bibliothèque LGPL dans un binaire propriétaire peut déclencher des obligations copyleft sur l'ensemble du binaire, vous obligeant à fournir les fichiers objet ou le code source pour la re-liaison.",
        'Divulgation des modifications : si vous modifiez le code source de la bibliothèque, vous devez publier ces modifications sous LGPL.',
        "Clause de rétro-ingénierie : vous devez permettre aux utilisateurs de faire de la rétro-ingénierie de votre application pour déboguer la bibliothèque liée.",
      ],
    },
    obligations: {
      en: [
        'Disclose source of modifications to the library.',
        'Allow reverse engineering for debugging.',
        'Include copyright and license notices.',
        'Provide mechanism for users to re-link with modified library (if statically linked).',
      ],
      fr: [
        'Divulguer le code source des modifications de la bibliothèque.',
        'Permettre la rétro-ingénierie pour le débogage.',
        'Inclure les avis de copyright et de licence.',
        'Fournir un mécanisme permettant aux utilisateurs de re-lier avec une bibliothèque modifiée (si liaison statique).',
      ],
    },
    recommendations: {
      en: [
        'Use dynamic linking (shared libraries) to avoid triggering copyleft on your proprietary code.',
        'Do not modify the library source: use it as-is whenever possible.',
        'If modification is necessary, isolate changes and publish them under LGPL.',
      ],
      fr: [
        'Utiliser la liaison dynamique (bibliothèques partagées) pour éviter de déclencher le copyleft sur votre code propriétaire.',
        "Ne pas modifier le code source de la bibliothèque : l'utiliser tel quel autant que possible.",
        "Si une modification est nécessaire, isoler les changements et les publier sous LGPL.",
      ],
    },
    url: 'https://spdx.org/licenses/LGPL-2.1-only.html',
  },
  'LGPL-3.0-only': {
    name: 'GNU Lesser General Public License v3.0',
    description: {
      en: 'A weak copyleft license. Like LGPL-2.1 but with additional protections against patent claims and tivoization.',
      fr: 'Une licence copyleft faible. Comme la LGPL-2.1 mais avec des protections supplémentaires contre les revendications de brevets et la tivoisation.',
    },
    legalRisks: {
      en: [
        'Static linking risk: same as LGPL-2.1, statically linking may trigger copyleft on the combined work.',
        'Anti-tivoization clause: you must provide installation instructions so users can run modified versions on the target hardware.',
        'Patent retaliation: filing patent claims related to the software terminates your license.',
      ],
      fr: [
        'Risque de liaison statique : comme la LGPL-2.1, la liaison statique peut déclencher le copyleft sur le travail combiné.',
        "Clause anti-tivoisation : vous devez fournir les instructions d'installation pour que les utilisateurs puissent exécuter des versions modifiées sur le matériel cible.",
        'Rétorsion de brevet : engager des revendications de brevet liées au logiciel résilie votre licence.',
      ],
    },
    obligations: {
      en: [
        'Disclose source of modifications to the library.',
        'Allow reverse engineering for debugging.',
        'Include copyright and license notices.',
        'Provide installation instructions for modified versions.',
      ],
      fr: [
        'Divulguer le code source des modifications de la bibliothèque.',
        'Permettre la rétro-ingénierie pour le débogage.',
        'Inclure les avis de copyright et de licence.',
        "Fournir les instructions d'installation pour les versions modifiées.",
      ],
    },
    recommendations: {
      en: [
        'Use dynamic linking to minimize copyleft impact on your proprietary code.',
        'Avoid modifying the library source: use it as a dependency without changes.',
        'If deploying on embedded hardware, ensure users can install modified library versions.',
      ],
      fr: [
        'Utiliser la liaison dynamique pour minimiser l\'impact copyleft sur votre code propriétaire.',
        "Éviter de modifier le code source de la bibliothèque : l'utiliser comme dépendance sans changement.",
        "Si vous déployez sur du matériel embarqué, assurez-vous que les utilisateurs peuvent installer des versions modifiées de la bibliothèque.",
      ],
    },
    url: 'https://spdx.org/licenses/LGPL-3.0-only.html',
  },
  'EPL-2.0': {
    name: 'Eclipse Public License 2.0',
    description: {
      en: 'A weak copyleft license used by the Eclipse Foundation. Modifications must be shared, but the license allows combining with proprietary code.',
      fr: "Une licence copyleft faible utilisée par la Fondation Eclipse. Les modifications doivent être partagées, mais la licence permet la combinaison avec du code propriétaire.",
    },
    legalRisks: {
      en: [
        'Module-level copyleft: modifications to EPL-licensed modules must be disclosed, but combining with proprietary modules is allowed.',
        'Patent retaliation clause: patent litigation related to the software terminates your rights.',
        'Choice of law provisions: EPL-2.0 disputes are governed by the law of the contributor\'s location, which may add legal complexity.',
      ],
      fr: [
        'Copyleft au niveau du module : les modifications des modules sous EPL doivent être divulguées, mais la combinaison avec des modules propriétaires est autorisée.',
        'Clause de rétorsion de brevet : un litige de brevet lié au logiciel résilie vos droits.',
        "Clauses de choix de loi : les litiges EPL-2.0 sont régis par la loi du lieu du contributeur, ce qui peut ajouter de la complexité juridique.",
      ],
    },
    obligations: {
      en: [
        'Disclose source of modifications to EPL-licensed modules.',
        'Include copyright and license notices.',
      ],
      fr: [
        'Divulguer le code source des modifications des modules sous EPL.',
        'Inclure les avis de copyright et de licence.',
      ],
    },
    recommendations: {
      en: [
        'If you only use EPL modules as dependencies without modification, no source disclosure is required.',
        'If you modify EPL-licensed code, publish changes under EPL-2.0.',
        'Compatible with GPL if the secondary license option is chosen by the contributor.',
      ],
      fr: [
        "Si vous utilisez les modules EPL uniquement comme dépendances sans modification, aucune divulgation de source n'est requise.",
        'Si vous modifiez du code sous EPL, publiez les changements sous EPL-2.0.',
        'Compatible avec la GPL si l\'option de licence secondaire est choisie par le contributeur.',
      ],
    },
    url: 'https://spdx.org/licenses/EPL-2.0.html',
  },
  'GPL-2.0-only': {
    name: 'GNU General Public License v2.0',
    description: {
      en: 'A strong copyleft license that requires any derivative work to be distributed under the same license. If you use GPL code, your entire project may need to be open-sourced under GPL.',
      fr: "Une licence copyleft forte qui exige que tout travail dérivé soit distribué sous la même licence. Si vous utilisez du code GPL, l'ensemble de votre projet peut devoir être open-sourcé sous GPL.",
    },
    legalRisks: {
      en: [
        'Strong copyleft: linking, including, or modifying GPL code makes your entire combined work a derivative work that must be distributed under GPL-2.0. This can force disclosure of proprietary source code.',
        'License incompatibility: GPL-2.0 is incompatible with many other licenses (Apache-2.0, GPL-3.0, some proprietary licenses), complicating multi-license projects.',
        'No explicit patent grant: unlike GPL-3.0, version 2.0 does not include an express patent license, leaving potential patent exposure.',
        'Distribution trigger: copyleft obligations are triggered upon distribution; internal use alone does not require disclosure.',
      ],
      fr: [
        "Copyleft fort : lier, inclure ou modifier du code GPL rend l'ensemble de votre travail combiné un travail dérivé qui doit être distribué sous GPL-2.0. Cela peut forcer la divulgation du code source propriétaire.",
        'Incompatibilité de licence : la GPL-2.0 est incompatible avec de nombreuses autres licences (Apache-2.0, GPL-3.0, certaines licences propriétaires), compliquant les projets multi-licences.',
        "Aucune concession de brevet explicite : contrairement à la GPL-3.0, la version 2.0 n'inclut pas de licence de brevet expresse, laissant une exposition potentielle aux brevets.",
        "Déclencheur de distribution : les obligations copyleft sont déclenchées lors de la distribution ; l'utilisation interne seule ne nécessite pas de divulgation.",
      ],
    },
    obligations: {
      en: [
        'Disclose entire source code of the combined work.',
        'Distribute the combined work under GPL-2.0.',
        'Include copyright and license notices.',
        'State changes made to the original code.',
      ],
      fr: [
        "Divulguer l'intégralité du code source du travail combiné.",
        'Distribuer le travail combiné sous GPL-2.0.',
        'Inclure les avis de copyright et de licence.',
        'Indiquer les modifications apportées au code original.',
      ],
    },
    recommendations: {
      en: [
        'Avoid including GPL-2.0 dependencies in proprietary or commercial software that will be distributed.',
        'If GPL-2.0 code is required, isolate it in a separate process communicating via IPC/API to avoid creating a derivative work.',
        'Consult legal counsel before using GPL-2.0 code in any product you intend to distribute.',
        'Internal-only deployments (no distribution) do not trigger copyleft obligations.',
      ],
      fr: [
        'Éviter d\'inclure des dépendances GPL-2.0 dans des logiciels propriétaires ou commerciaux destinés à être distribués.',
        'Si du code GPL-2.0 est nécessaire, l\'isoler dans un processus séparé communiquant via IPC/API pour éviter de créer un travail dérivé.',
        'Consulter un conseiller juridique avant d\'utiliser du code GPL-2.0 dans tout produit que vous comptez distribuer.',
        "Les déploiements internes uniquement (sans distribution) ne déclenchent pas les obligations copyleft.",
      ],
    },
    url: 'https://spdx.org/licenses/GPL-2.0-only.html',
  },
  'GPL-3.0-only': {
    name: 'GNU General Public License v3.0',
    description: {
      en: 'A strong copyleft license. Like GPL-2.0 but with additional protections against patent claims and tivoization. Any derivative work must be open-sourced under GPL-3.0.',
      fr: "Une licence copyleft forte. Comme la GPL-2.0 mais avec des protections supplémentaires contre les revendications de brevets et la tivoisation. Tout travail dérivé doit être open-sourcé sous GPL-3.0.",
    },
    legalRisks: {
      en: [
        'Strong copyleft: same derivative work obligations as GPL-2.0; your entire project must be GPL-3.0 if you incorporate GPL-3.0 code.',
        'Anti-tivoization clause: if you distribute on consumer hardware, you must provide installation instructions enabling users to run modified versions.',
        'Patent retaliation: contributors grant patent licenses, but suing for patent infringement terminates all rights.',
        'Incompatible with GPL-2.0-only: code under GPL-2.0 (without "or later" clause) cannot be combined with GPL-3.0 code.',
      ],
      fr: [
        "Copyleft fort : mêmes obligations de travail dérivé que la GPL-2.0 ; l'ensemble de votre projet doit être GPL-3.0 si vous incorporez du code GPL-3.0.",
        "Clause anti-tivoisation : si vous distribuez sur du matériel grand public, vous devez fournir les instructions d'installation permettant aux utilisateurs d'exécuter des versions modifiées.",
        'Rétorsion de brevet : les contributeurs concèdent des licences de brevet, mais poursuivre pour contrefaçon de brevet résilie tous les droits.',
        'Incompatible avec GPL-2.0-only : le code sous GPL-2.0 (sans clause « ou ultérieure ») ne peut pas être combiné avec du code GPL-3.0.',
      ],
    },
    obligations: {
      en: [
        'Disclose entire source code of the combined work.',
        'Distribute under GPL-3.0.',
        'Include copyright and license notices.',
        'State changes made to the code.',
        'Provide installation instructions for the target platform.',
      ],
      fr: [
        "Divulguer l'intégralité du code source du travail combiné.",
        'Distribuer sous GPL-3.0.',
        'Inclure les avis de copyright et de licence.',
        'Indiquer les modifications apportées au code.',
        "Fournir les instructions d'installation pour la plateforme cible.",
      ],
    },
    recommendations: {
      en: [
        'Avoid in proprietary projects: the copyleft obligation will require open-sourcing your entire codebase upon distribution.',
        'If needed, isolate GPL-3.0 components as separate processes with API boundaries.',
        'Consult legal counsel before integrating GPL-3.0 dependencies.',
        'Internal-only deployments (no distribution) do not trigger copyleft.',
      ],
      fr: [
        "Éviter dans les projets propriétaires : l'obligation copyleft nécessitera l'open-sourcing de toute votre base de code lors de la distribution.",
        'Si nécessaire, isoler les composants GPL-3.0 comme des processus séparés avec des frontières API.',
        'Consulter un conseiller juridique avant d\'intégrer des dépendances GPL-3.0.',
        "Les déploiements internes uniquement (sans distribution) ne déclenchent pas le copyleft.",
      ],
    },
    url: 'https://spdx.org/licenses/GPL-3.0-only.html',
  },
  'AGPL-3.0-only': {
    name: 'GNU Affero General Public License v3.0',
    description: {
      en: 'The strongest copyleft license. Like GPL-3.0, but also requires providing source code to users who interact with the software over a network (SaaS). This is the highest compliance risk.',
      fr: "La licence copyleft la plus forte. Comme la GPL-3.0, mais exige aussi de fournir le code source aux utilisateurs qui interagissent avec le logiciel via un réseau (SaaS). C'est le risque de conformité le plus élevé.",
    },
    legalRisks: {
      en: [
        'Network copyleft: unlike GPL, AGPL triggers source disclosure when users interact with the software over a network (SaaS, web services). This is the most restrictive open-source obligation.',
        'Full codebase exposure: incorporating AGPL code into a larger application may require you to release the entire application source code under AGPL.',
        'Patent retaliation: same as GPL-3.0.',
        'Anti-tivoization: same installation instruction requirements as GPL-3.0.',
        'Many organizations explicitly prohibit AGPL dependencies in their codebase policies.',
      ],
      fr: [
        "Copyleft réseau : contrairement à la GPL, l'AGPL déclenche la divulgation du source lorsque les utilisateurs interagissent avec le logiciel via un réseau (SaaS, services web). C'est l'obligation open-source la plus restrictive.",
        "Exposition complète du code : incorporer du code AGPL dans une application plus large peut vous obliger à publier le code source de l'ensemble de l'application sous AGPL.",
        'Rétorsion de brevet : identique à la GPL-3.0.',
        "Anti-tivoisation : mêmes exigences d'instructions d'installation que la GPL-3.0.",
        'De nombreuses organisations interdisent explicitement les dépendances AGPL dans leurs politiques de code.',
      ],
    },
    obligations: {
      en: [
        'Disclose entire source code of the combined work.',
        'Distribute under AGPL-3.0.',
        'Provide source code to network users (SaaS/web).',
        'Include copyright and license notices.',
        'State changes made to the code.',
      ],
      fr: [
        "Divulguer l'intégralité du code source du travail combiné.",
        'Distribuer sous AGPL-3.0.',
        'Fournir le code source aux utilisateurs réseau (SaaS/web).',
        'Inclure les avis de copyright et de licence.',
        'Indiquer les modifications apportées au code.',
      ],
    },
    recommendations: {
      en: [
        'Do not include AGPL dependencies in commercial SaaS products without full legal review.',
        'If AGPL code is essential, isolate it in a completely separate service with strict API boundaries.',
        'Consider replacing AGPL dependencies with permissively-licensed alternatives.',
        'Add AGPL to your organization\'s license deny-list to prevent accidental adoption.',
      ],
      fr: [
        "Ne pas inclure de dépendances AGPL dans les produits SaaS commerciaux sans un examen juridique complet.",
        "Si le code AGPL est essentiel, l'isoler dans un service complètement séparé avec des frontières API strictes.",
        'Envisager de remplacer les dépendances AGPL par des alternatives sous licence permissive.',
        "Ajouter l'AGPL à la liste de licences interdites de votre organisation pour empêcher l'adoption accidentelle.",
      ],
    },
    url: 'https://spdx.org/licenses/AGPL-3.0-only.html',
  },
  'BUSL-1.1': {
    name: 'Business Source License 1.1',
    description: {
      en: 'A source-available license that converts to an open-source license (typically Apache-2.0) after a specified change date. Until then, production use is restricted. Common in databases and infrastructure software (MariaDB, CockroachDB, HashiCorp).',
      fr: "Une licence source-disponible qui se convertit en licence open-source (typiquement Apache-2.0) après une date de changement spécifiée. Jusqu'alors, l'utilisation en production est restreinte. Courante dans les bases de données et logiciels d'infrastructure (MariaDB, CockroachDB, HashiCorp).",
    },
    legalRisks: {
      en: [
        'Not open-source: BUSL is a proprietary source-available license. Production use before the change date may violate the license.',
        'Additional Use Grant varies: each BUSL-licensed project defines its own "Additional Use Grant" which may or may not permit your use case. You must read each project\'s specific grant.',
        'Change date uncertainty: the conversion to an open-source license happens at a specified future date; you cannot use the code under permissive terms until that date.',
        'Competitors may be explicitly excluded from the Additional Use Grant.',
      ],
      fr: [
        "N'est pas open-source : BUSL est une licence propriétaire source-disponible. L'utilisation en production avant la date de changement peut violer la licence.",
        "La concession d'utilisation additionnelle varie : chaque projet sous BUSL définit sa propre « concession d'utilisation additionnelle » qui peut ou non permettre votre cas d'usage. Vous devez lire la concession spécifique de chaque projet.",
        "Incertitude sur la date de changement : la conversion en licence open-source se produit à une date future spécifiée ; vous ne pouvez pas utiliser le code sous des termes permissifs avant cette date.",
        "Les concurrents peuvent être explicitement exclus de la concession d'utilisation additionnelle.",
      ],
    },
    obligations: {
      en: [
        'No production use until the change date (unless permitted by the Additional Use Grant).',
        'Comply with the specific Additional Use Grant terms defined by the project.',
        'After the change date, comply with the converted open-source license (usually Apache-2.0).',
      ],
      fr: [
        "Pas d'utilisation en production avant la date de changement (sauf si permis par la concession d'utilisation additionnelle).",
        "Respecter les conditions spécifiques de la concession d'utilisation additionnelle définies par le projet.",
        'Après la date de changement, se conformer à la licence open-source convertie (généralement Apache-2.0).',
      ],
    },
    recommendations: {
      en: [
        'Read the specific Additional Use Grant for each BUSL-licensed dependency: terms vary per project.',
        'Verify whether your use case is permitted before adopting the dependency.',
        'Plan for license conversion: track change dates and prepare for the transition.',
        'Consider alternatives with permissive licenses if the BUSL terms are too restrictive.',
      ],
      fr: [
        "Lire la concession d'utilisation additionnelle spécifique pour chaque dépendance sous BUSL : les conditions varient par projet.",
        "Vérifier si votre cas d'usage est permis avant d'adopter la dépendance.",
        'Planifier la conversion de licence : suivre les dates de changement et préparer la transition.',
        'Envisager des alternatives sous licences permissives si les conditions BUSL sont trop restrictives.',
      ],
    },
    url: 'https://spdx.org/licenses/BUSL-1.1.html',
  },
  HPND: {
    name: 'Historical Permission Notice and Disclaimer',
    description: {
      en: 'A permissive license very similar to MIT/BSD. It allows redistribution and use in source and binary forms, with or without modification. One of the oldest open-source license patterns.',
      fr: "Une licence permissive très similaire à MIT/BSD. Elle autorise la redistribution et l'utilisation sous forme source et binaire, avec ou sans modification. L'un des plus anciens modèles de licence open-source.",
    },
    legalRisks: {
      en: [
        'No patent grant: same as MIT/BSD.',
        'Provided "as is" without warranty.',
        'Minimal risk: functionally equivalent to MIT.',
      ],
      fr: [
        'Aucune concession de brevet : identique à MIT/BSD.',
        "Fourni « en l'état » sans garantie.",
        'Risque minimal : fonctionnellement équivalent à MIT.',
      ],
    },
    obligations: {
      en: ['Include copyright notice and permission notice in all copies.'],
      fr: ["Inclure l'avis de copyright et l'avis de permission dans toutes les copies."],
    },
    recommendations: {
      en: [
        'Treat identically to MIT: include the license notice in distributions.',
        'Safe for commercial and proprietary use.',
      ],
      fr: [
        'Traiter de manière identique à MIT : inclure l\'avis de licence dans les distributions.',
        'Utilisation commerciale et propriétaire sans restriction.',
      ],
    },
    url: 'https://spdx.org/licenses/HPND.html',
  },
  Ruby: {
    name: 'Ruby License',
    description: {
      en: 'The license used by the Ruby programming language and some Ruby gems. It is a permissive license similar to BSD, allowing use, modification, and redistribution with minimal restrictions.',
      fr: "La licence utilisée par le langage de programmation Ruby et certaines gems Ruby. C'est une licence permissive similaire à BSD, autorisant l'utilisation, la modification et la redistribution avec des restrictions minimales.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not address patents.',
        'Custom license text: not as widely reviewed as MIT/BSD, may require additional legal review.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas les brevets.",
        "Texte de licence personnalisé : pas aussi largement examiné que MIT/BSD, peut nécessiter un examen juridique supplémentaire.",
      ],
    },
    obligations: {
      en: ['Include copyright notice.', 'Include license text in distributions.'],
      fr: ["Inclure l'avis de copyright.", 'Inclure le texte de la licence dans les distributions.'],
    },
    recommendations: {
      en: [
        'Safe for commercial use: similar obligations to BSD.',
        'Include the license file in your distributions.',
      ],
      fr: [
        'Utilisation commerciale sûre : obligations similaires à BSD.',
        'Inclure le fichier de licence dans vos distributions.',
      ],
    },
    url: 'https://spdx.org/licenses/Ruby.html',
  },
  'BSD-4-Clause': {
    name: 'BSD 4-Clause "Original"',
    description: {
      en: 'The original BSD license with an advertising clause requiring acknowledgment in all advertising materials. This clause has been widely criticized and most projects have moved to BSD-2-Clause or BSD-3-Clause.',
      fr: "La licence BSD originale avec une clause publicitaire exigeant une mention dans tous les supports publicitaires. Cette clause a été largement critiquée et la plupart des projets sont passés à BSD-2-Clause ou BSD-3-Clause.",
    },
    legalRisks: {
      en: [
        'Advertising clause: all advertising materials mentioning features or use of the software must include a specific acknowledgment. This is burdensome with many BSD-4-Clause dependencies.',
        'GPL-incompatible: the advertising clause makes BSD-4-Clause incompatible with GPL-licensed code.',
        'Compliance burden scales: the advertising obligation multiplies with each BSD-4-Clause dependency used.',
      ],
      fr: [
        "Clause publicitaire : tous les supports publicitaires mentionnant les fonctionnalités ou l'utilisation du logiciel doivent inclure une mention spécifique. C'est contraignant avec de nombreuses dépendances BSD-4-Clause.",
        'Incompatible avec la GPL : la clause publicitaire rend la BSD-4-Clause incompatible avec le code sous GPL.',
        "La charge de conformité augmente : l'obligation publicitaire se multiplie avec chaque dépendance BSD-4-Clause utilisée.",
      ],
    },
    obligations: {
      en: [
        'Include copyright notice.',
        'Include license text.',
        'Acknowledge in all advertising materials mentioning features or use of the software.',
      ],
      fr: [
        "Inclure l'avis de copyright.",
        'Inclure le texte de la licence.',
        "Mention dans tous les supports publicitaires mentionnant les fonctionnalités ou l'utilisation du logiciel.",
      ],
    },
    recommendations: {
      en: [
        'Consider replacing with a dependency under BSD-2-Clause or BSD-3-Clause if available.',
        'If you must use it, ensure your marketing and advertising materials include the required acknowledgments.',
        'Do not combine with GPL-licensed code: they are incompatible.',
      ],
      fr: [
        'Envisager de remplacer par une dépendance sous BSD-2-Clause ou BSD-3-Clause si disponible.',
        'Si vous devez l\'utiliser, assurez-vous que vos supports marketing et publicitaires incluent les mentions requises.',
        'Ne pas combiner avec du code sous GPL : ils sont incompatibles.',
      ],
    },
    url: 'https://spdx.org/licenses/BSD-4-Clause.html',
  },
  'Ruby-1.8': {
    name: 'Ruby License 1.8',
    description: {
      en: 'The license used by the Ruby 1.8 programming language. It is a permissive license similar to BSD, allowing use, modification, and redistribution. Ruby 1.8 was dual-licensed under this license and GPL-2.0.',
      fr: "La licence utilisée par le langage Ruby 1.8. C'est une licence permissive similaire à BSD, autorisant l'utilisation, la modification et la redistribution. Ruby 1.8 était sous double licence avec GPL-2.0.",
    },
    legalRisks: {
      en: [
        'Dual-licensing with GPL-2.0: you must choose one license; if you choose GPL-2.0, full copyleft obligations apply.',
        'Custom license text: less legally vetted than MIT/BSD.',
      ],
      fr: [
        'Double licence avec GPL-2.0 : vous devez choisir une licence ; si vous choisissez la GPL-2.0, les obligations copyleft complètes s\'appliquent.',
        'Texte de licence personnalisé : moins vérifié juridiquement que MIT/BSD.',
      ],
    },
    obligations: {
      en: ['Include copyright notice.', 'Include license text in distributions.'],
      fr: ["Inclure l'avis de copyright.", 'Inclure le texte de la licence dans les distributions.'],
    },
    recommendations: {
      en: [
        'Choose the Ruby license (not GPL-2.0) for maximum flexibility.',
        'Safe for commercial use under the Ruby license option.',
      ],
      fr: [
        'Choisir la licence Ruby (pas GPL-2.0) pour une flexibilité maximale.',
        'Utilisation commerciale sûre sous l\'option licence Ruby.',
      ],
    },
    url: 'https://spdx.org/licenses/Ruby.html',
  },
  'Hippocratic-2.1': {
    name: 'Hippocratic License 2.1',
    description: {
      en: 'An ethical source license that permits use, modification, and distribution of software, provided the use does not violate human rights principles as defined by the United Nations Universal Declaration of Human Rights.',
      fr: "Une licence éthique qui autorise l'utilisation, la modification et la distribution de logiciels, à condition que l'utilisation ne viole pas les principes des droits de l'homme définis par la Déclaration universelle des droits de l'homme des Nations Unies.",
    },
    legalRisks: {
      en: [
        'Not OSI-approved: the ethical use restriction means it does not meet the Open Source Definition, which may conflict with organizational open-source policies.',
        'Vague compliance criteria: "human rights violations" is subjective and could lead to disputes about whether specific uses are permitted.',
        'Use restriction enforceability: ethical use clauses have not been tested in court, creating legal uncertainty.',
        'May be incompatible with other open-source licenses.',
      ],
      fr: [
        "Non approuvée par l'OSI : la restriction d'utilisation éthique signifie qu'elle ne répond pas à la définition Open Source, ce qui peut entrer en conflit avec les politiques open-source organisationnelles.",
        "Critères de conformité vagues : les « violations des droits de l'homme » sont subjectives et pourraient mener à des litiges sur les utilisations permises.",
        "Applicabilité de la restriction d'utilisation : les clauses d'utilisation éthique n'ont pas été testées en justice, créant une incertitude juridique.",
        'Peut être incompatible avec d\'autres licences open-source.',
      ],
    },
    obligations: {
      en: [
        'Include copyright notice.',
        'Include license text.',
        'Must not be used in violation of United Nations human rights principles.',
      ],
      fr: [
        "Inclure l'avis de copyright.",
        'Inclure le texte de la licence.',
        "Ne doit pas être utilisé en violation des principes des droits de l'homme des Nations Unies.",
      ],
    },
    recommendations: {
      en: [
        'Evaluate whether your organization\'s policies allow non-OSI-approved licenses.',
        'Consider the legal uncertainty of ethical use clauses before adopting.',
        'If possible, prefer dependencies with well-established permissive licenses.',
      ],
      fr: [
        "Évaluer si les politiques de votre organisation autorisent les licences non approuvées par l'OSI.",
        "Considérer l'incertitude juridique des clauses d'utilisation éthique avant d'adopter.",
        'Si possible, préférer les dépendances avec des licences permissives bien établies.',
      ],
    },
    url: 'https://firstdonoharm.dev/version/2/1/license/',
  },
  PRAWN: {
    name: 'Prawn License',
    description: {
      en: 'A custom permissive license used by the Prawn PDF library for Ruby. It allows use, modification, and redistribution of the software with minimal restrictions, similar to other permissive open source licenses.',
      fr: "Une licence permissive personnalisée utilisée par la bibliothèque Prawn PDF pour Ruby. Elle autorise l'utilisation, la modification et la redistribution du logiciel avec des restrictions minimales.",
    },
    legalRisks: {
      en: [
        'Custom license: not a standard SPDX license; terms may differ from expected permissive behavior and require individual review.',
        'No patent grant: does not address patents.',
        'Limited legal precedent: custom licenses lack the community review and case law of standard licenses.',
      ],
      fr: [
        'Licence personnalisée : pas une licence SPDX standard ; les termes peuvent différer du comportement permissif attendu et nécessitent un examen individuel.',
        "Aucune concession de brevet : n'aborde pas les brevets.",
        'Précédent juridique limité : les licences personnalisées manquent de l\'examen communautaire et de la jurisprudence des licences standard.',
      ],
    },
    obligations: {
      en: ['Include copyright notice.', 'Include license text in distributions.'],
      fr: ["Inclure l'avis de copyright.", 'Inclure le texte de la licence dans les distributions.'],
    },
    recommendations: {
      en: [
        'Review the full license text to confirm it meets your compliance requirements.',
        'Generally safe for use: obligations are similar to BSD/MIT.',
      ],
      fr: [
        'Examiner le texte complet de la licence pour confirmer qu\'il répond à vos exigences de conformité.',
        'Généralement sûr à utiliser : obligations similaires à BSD/MIT.',
      ],
    },
    url: 'https://github.com/prawnpdf/prawn/blob/master/COPYING',
  },
  'MIT-0': {
    name: 'MIT No Attribution',
    description: {
      en: 'A permissive license based on MIT but with no attribution requirement. You can use, modify, and distribute the software without including copyright notices or license text.',
      fr: "Une licence permissive basée sur MIT mais sans exigence d'attribution. Vous pouvez utiliser, modifier et distribuer le logiciel sans inclure les avis de copyright ni le texte de la licence.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not address patents, leaving potential exposure to patent claims.',
        'Provided "as is" without warranty: no legal recourse if the software causes damage.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas les brevets, laissant une exposition potentielle aux revendications de brevets.",
        "Fourni « en l'état » sans garantie : aucun recours juridique si le logiciel cause des dommages.",
      ],
    },
    obligations: {
      en: ['No obligations: no attribution or notice required.'],
      fr: ["Aucune obligation : aucune attribution ni mention requise."],
    },
    recommendations: {
      en: [
        'No action needed: this license imposes no requirements.',
        'Ideal for commercial and proprietary use with zero compliance overhead.',
      ],
      fr: [
        "Aucune action requise : cette licence n'impose aucune exigence.",
        'Idéale pour une utilisation commerciale et propriétaire sans surcharge de conformité.',
      ],
    },
    url: 'https://spdx.org/licenses/MIT-0.html',
  },
  'Apache-1.0': {
    name: 'Apache License 1.0',
    description: {
      en: 'The original Apache license with an advertising clause requiring acknowledgment in advertising materials. Superseded by Apache-1.1 and Apache-2.0.',
      fr: "La licence Apache originale avec une clause publicitaire exigeant une mention dans les supports publicitaires. Remplacée par Apache-1.1 et Apache-2.0.",
    },
    legalRisks: {
      en: [
        'Advertising clause: all advertising materials must include a specific acknowledgment, similar to BSD-4-Clause.',
        'No patent grant: does not address patent rights.',
        'GPL-incompatible: the advertising clause makes it incompatible with GPL-licensed code.',
      ],
      fr: [
        'Clause publicitaire : tous les supports publicitaires doivent inclure une mention spécifique, similaire à BSD-4-Clause.',
        "Aucune concession de brevet : n'aborde pas les droits de brevet.",
        'Incompatible avec la GPL : la clause publicitaire la rend incompatible avec le code sous GPL.',
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Acknowledge in advertising materials.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        'Mention dans les supports publicitaires.',
      ],
    },
    recommendations: {
      en: [
        'Prefer dependencies under Apache-2.0 which has no advertising clause and includes a patent grant.',
        'If you must use it, ensure advertising materials include the required acknowledgment.',
        'Do not combine with GPL-licensed code.',
      ],
      fr: [
        "Préférer les dépendances sous Apache-2.0 qui n'a pas de clause publicitaire et inclut une concession de brevet.",
        "Si vous devez l'utiliser, assurez-vous que les supports publicitaires incluent la mention requise.",
        'Ne pas combiner avec du code sous GPL.',
      ],
    },
    url: 'https://spdx.org/licenses/Apache-1.0.html',
  },
  'Apache-1.1': {
    name: 'Apache License 1.1',
    description: {
      en: 'An updated version of the Apache License 1.0 that removed the advertising clause. Still lacks the express patent grant introduced in Apache-2.0.',
      fr: "Une version mise à jour de la licence Apache 1.0 qui a supprimé la clause publicitaire. Ne contient toujours pas la concession de brevet expresse introduite dans Apache-2.0.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not address patent rights, unlike Apache-2.0.',
        'Name restriction: the names "Apache" and "Apache Software Foundation" may not be used to endorse or promote products without prior written permission.',
        'Largely obsolete: most projects have migrated to Apache-2.0.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas les droits de brevet, contrairement à Apache-2.0.",
        "Restriction de nom : les noms « Apache » et « Apache Software Foundation » ne peuvent pas être utilisés pour recommander ou promouvoir des produits sans permission écrite préalable.",
        'Largement obsolète : la plupart des projets ont migré vers Apache-2.0.',
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Do not use "Apache" name for endorsement without permission.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        "Ne pas utiliser le nom « Apache » pour des recommandations sans permission.",
      ],
    },
    recommendations: {
      en: [
        'Prefer Apache-2.0 dependencies for better patent protection.',
        'Safe for commercial use: similar to BSD-3-Clause in practice.',
      ],
      fr: [
        'Préférer les dépendances sous Apache-2.0 pour une meilleure protection par brevet.',
        'Utilisation commerciale sûre : similaire à BSD-3-Clause en pratique.',
      ],
    },
    url: 'https://spdx.org/licenses/Apache-1.1.html',
  },
  'BSD-3-Clause-Clear': {
    name: 'BSD 3-Clause Clear License',
    description: {
      en: 'A variant of the BSD 3-Clause license that explicitly states no patent rights are granted. This makes the patent position clear rather than leaving it ambiguous.',
      fr: "Une variante de la licence BSD 3-Clause qui stipule explicitement qu'aucun droit de brevet n'est concédé. Cela clarifie la position sur les brevets plutôt que de la laisser ambiguë.",
    },
    legalRisks: {
      en: [
        'Explicit no-patent clause: unlike standard BSD-3, this license explicitly states that no patent rights are granted, increasing patent exposure.',
        'Non-endorsement clause: same as BSD-3-Clause.',
        'Provided "as is" without warranty.',
      ],
      fr: [
        "Clause explicite de non-brevet : contrairement à la BSD-3 standard, cette licence stipule explicitement qu'aucun droit de brevet n'est concédé, augmentant l'exposition aux brevets.",
        'Clause de non-recommandation : identique à BSD-3-Clause.',
        "Fourni « en l'état » sans garantie.",
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Do not use contributor names for endorsement without permission.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        'Ne pas utiliser les noms des contributeurs pour des recommandations sans permission.',
      ],
    },
    recommendations: {
      en: [
        'Be aware that patent rights are explicitly excluded: evaluate patent risk for critical dependencies.',
        'Safe for commercial use with standard BSD-3 compliance practices.',
        'If patent protection is important, prefer Apache-2.0 licensed alternatives.',
      ],
      fr: [
        'Savoir que les droits de brevet sont explicitement exclus : évaluer le risque de brevet pour les dépendances critiques.',
        'Utilisation commerciale sûre avec les pratiques de conformité BSD-3 standard.',
        'Si la protection par brevet est importante, préférer les alternatives sous Apache-2.0.',
      ],
    },
    url: 'https://spdx.org/licenses/BSD-3-Clause-Clear.html',
  },
  'BSD-1-Clause': {
    name: 'BSD 1-Clause License',
    description: {
      en: 'The simplest BSD license variant, requiring only the retention of the copyright notice in source code redistributions. No requirements for binary distributions.',
      fr: "La variante BSD la plus simple, exigeant uniquement la conservation de l'avis de copyright dans les redistributions de code source. Aucune exigence pour les distributions binaires.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not address patents.',
        'Provided "as is" without warranty.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas les brevets.",
        "Fourni « en l'état » sans garantie.",
      ],
    },
    obligations: {
      en: ['Include copyright notice in source code redistributions.'],
      fr: ["Inclure l'avis de copyright dans les redistributions de code source."],
    },
    recommendations: {
      en: [
        'Minimal compliance burden: just retain the copyright notice in source distributions.',
        'Safe for commercial and proprietary use.',
      ],
      fr: [
        "Charge de conformité minimale : conserver simplement l'avis de copyright dans les distributions source.",
        'Utilisation commerciale et propriétaire sans restriction.',
      ],
    },
    url: 'https://spdx.org/licenses/BSD-1-Clause.html',
  },
  'CC-BY-3.0': {
    name: 'Creative Commons Attribution 3.0',
    description: {
      en: 'A Creative Commons license requiring attribution only. Designed for creative content rather than software. Allows commercial use, modifications, and redistribution with proper credit.',
      fr: "Une licence Creative Commons exigeant uniquement l'attribution. Conçue pour le contenu créatif plutôt que le logiciel. Autorise l'utilisation commerciale, les modifications et la redistribution avec mention appropriée.",
    },
    legalRisks: {
      en: [
        'Not designed for software: CC licenses do not address patents or software-specific concerns, making them unsuitable for code.',
        'Attribution requirements can be complex: must credit the original author in the manner specified.',
        'Moral rights: some jurisdictions enforce moral rights that CC-BY does not waive.',
      ],
      fr: [
        "Non conçue pour le logiciel : les licences CC n'abordent pas les brevets ni les préoccupations spécifiques au logiciel, les rendant inadaptées pour le code.",
        "Les exigences d'attribution peuvent être complexes : il faut créditer l'auteur original de la manière spécifiée.",
        'Droits moraux : certaines juridictions appliquent des droits moraux que CC-BY ne renonce pas.',
      ],
    },
    obligations: {
      en: [
        'Provide attribution to the original author.',
        'Indicate if changes were made.',
        'Include a link to the license.',
      ],
      fr: [
        "Fournir l'attribution à l'auteur original.",
        'Indiquer si des modifications ont été apportées.',
        'Inclure un lien vers la licence.',
      ],
    },
    recommendations: {
      en: [
        'Appropriate for documentation, images, and data: not recommended for software source code.',
        'Ensure attribution is provided in the manner specified by the licensor.',
        'Consider CC-BY-4.0 for newer projects as it includes improvements.',
      ],
      fr: [
        "Appropriée pour la documentation, les images et les données : non recommandée pour le code source logiciel.",
        "S'assurer que l'attribution est fournie de la manière spécifiée par le concédant.",
        'Envisager CC-BY-4.0 pour les nouveaux projets car elle inclut des améliorations.',
      ],
    },
    url: 'https://spdx.org/licenses/CC-BY-3.0.html',
  },
  'CC-BY-4.0': {
    name: 'Creative Commons Attribution 4.0',
    description: {
      en: 'A Creative Commons license requiring attribution only. Version 4.0 includes sui generis database rights and is more internationally robust than 3.0. Designed for content, not software.',
      fr: "Une licence Creative Commons exigeant uniquement l'attribution. La version 4.0 inclut les droits sui generis sur les bases de données et est plus robuste internationalement que la 3.0. Conçue pour le contenu, pas le logiciel.",
    },
    legalRisks: {
      en: [
        'Not designed for software: does not address patents or software-specific issues.',
        'Attribution requirements must be carefully followed.',
        'Database rights included: covers data compilations, which may have unexpected implications.',
      ],
      fr: [
        "Non conçue pour le logiciel : n'aborde pas les brevets ni les problèmes spécifiques au logiciel.",
        "Les exigences d'attribution doivent être soigneusement respectées.",
        'Droits sur les bases de données inclus : couvre les compilations de données, ce qui peut avoir des implications inattendues.',
      ],
    },
    obligations: {
      en: [
        'Provide attribution to the original author.',
        'Indicate if changes were made.',
        'Include a link to the license.',
      ],
      fr: [
        "Fournir l'attribution à l'auteur original.",
        'Indiquer si des modifications ont été apportées.',
        'Inclure un lien vers la licence.',
      ],
    },
    recommendations: {
      en: [
        'Best suited for documentation, media assets, and data files.',
        'Preferred over CC-BY-3.0 for new content due to improved international applicability.',
        'Not recommended for software: use MIT or Apache-2.0 instead.',
      ],
      fr: [
        'Mieux adaptée pour la documentation, les ressources médias et les fichiers de données.',
        "Préférée à CC-BY-3.0 pour les nouveaux contenus grâce à une meilleure applicabilité internationale.",
        'Non recommandée pour le logiciel : utiliser MIT ou Apache-2.0 à la place.',
      ],
    },
    url: 'https://spdx.org/licenses/CC-BY-4.0.html',
  },
  WTFPL: {
    name: 'Do What The F*ck You Want To Public License',
    description: {
      en: 'An ultra-permissive license with no conditions at all. Effectively places the software in the public domain, though its informal language may raise legal concerns.',
      fr: "Une licence ultra-permissive sans aucune condition. Place effectivement le logiciel dans le domaine public, bien que son langage informel puisse soulever des préoccupations juridiques.",
    },
    legalRisks: {
      en: [
        'Informal language: the license text is not written in standard legal terms, creating ambiguity about its enforceability.',
        'No patent grant: does not address patents.',
        'Not recognized by some organizations: some legal teams reject WTFPL as insufficiently clear.',
      ],
      fr: [
        "Langage informel : le texte de la licence n'est pas rédigé dans des termes juridiques standards, créant une ambiguïté sur son applicabilité.",
        "Aucune concession de brevet : n'aborde pas les brevets.",
        'Non reconnue par certaines organisations : certaines équipes juridiques rejettent la WTFPL comme insuffisamment claire.',
      ],
    },
    obligations: {
      en: ['No obligations.'],
      fr: ['Aucune obligation.'],
    },
    recommendations: {
      en: [
        'If your legal team requires formal license language, consider treating as equivalent to MIT-0 or Unlicense.',
        'Safe for use in practice, but may require justification in compliance audits.',
      ],
      fr: [
        'Si votre équipe juridique exige un langage de licence formel, envisager de traiter comme équivalent à MIT-0 ou Unlicense.',
        "Sûr à utiliser en pratique, mais peut nécessiter une justification lors des audits de conformité.",
      ],
    },
    url: 'https://spdx.org/licenses/WTFPL.html',
  },
  Zlib: {
    name: 'zlib License',
    description: {
      en: 'A permissive license requiring that the origin of the software not be misrepresented and that altered versions be marked as such. No attribution required in binary distributions.',
      fr: "Une licence permissive exigeant que l'origine du logiciel ne soit pas déformée et que les versions modifiées soient marquées comme telles. Aucune attribution requise dans les distributions binaires.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not address patents.',
        'Misrepresentation clause: you must not claim you wrote the original software.',
        'Provided "as is" without warranty.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas les brevets.",
        "Clause de non-déformation : vous ne devez pas prétendre avoir écrit le logiciel original.",
        "Fourni « en l'état » sans garantie.",
      ],
    },
    obligations: {
      en: [
        'Do not misrepresent the origin of the software.',
        'Mark altered source versions plainly as such.',
      ],
      fr: [
        "Ne pas déformer l'origine du logiciel.",
        'Marquer clairement les versions source modifiées comme telles.',
      ],
    },
    recommendations: {
      en: [
        'Safe for commercial and proprietary use.',
        'If distributing modified source code, clearly mark your changes.',
        'No notice required in binary-only distributions.',
      ],
      fr: [
        'Utilisation commerciale et propriétaire sans restriction.',
        'Si vous distribuez du code source modifié, marquer clairement vos changements.',
        'Aucune mention requise dans les distributions binaires uniquement.',
      ],
    },
    url: 'https://spdx.org/licenses/Zlib.html',
  },
  'BSL-1.0': {
    name: 'Boost Software License 1.0',
    description: {
      en: 'A permissive license similar to MIT. No attribution is required in binary-only distributions, making it particularly convenient for compiled libraries.',
      fr: "Une licence permissive similaire à MIT. Aucune attribution n'est requise dans les distributions binaires uniquement, ce qui la rend particulièrement pratique pour les bibliothèques compilées.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not address patent rights.',
        'Provided "as is" without warranty.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas les droits de brevet.",
        "Fourni « en l'état » sans garantie.",
      ],
    },
    obligations: {
      en: ['Include copyright notice and license text in source distributions.'],
      fr: ["Inclure l'avis de copyright et le texte de la licence dans les distributions source."],
    },
    recommendations: {
      en: [
        'Safe for commercial and proprietary use.',
        'No notice required in binary-only distributions: simpler compliance than MIT.',
      ],
      fr: [
        'Utilisation commerciale et propriétaire sans restriction.',
        'Aucune mention requise dans les distributions binaires uniquement : conformité plus simple que MIT.',
      ],
    },
    url: 'https://spdx.org/licenses/BSL-1.0.html',
  },
  'PSF-2.0': {
    name: 'Python Software Foundation License 2.0',
    description: {
      en: 'A permissive license used by the Python Software Foundation for Python-related projects. Allows use, modification, and redistribution with minimal requirements.',
      fr: "Une licence permissive utilisée par la Python Software Foundation pour les projets liés à Python. Autorise l'utilisation, la modification et la redistribution avec des exigences minimales.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not address patent rights.',
        'Python-specific: less commonly reviewed outside the Python ecosystem.',
        'Provided "as is" without warranty.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas les droits de brevet.",
        "Spécifique à Python : moins couramment examinée en dehors de l'écosystème Python.",
        "Fourni « en l'état » sans garantie.",
      ],
    },
    obligations: {
      en: ['Include copyright notice and license text.'],
      fr: ["Inclure l'avis de copyright et le texte de la licence."],
    },
    recommendations: {
      en: [
        'Safe for commercial and proprietary use.',
        'Common in the Python ecosystem: standard compliance practices apply.',
      ],
      fr: [
        'Utilisation commerciale et propriétaire sans restriction.',
        "Courante dans l'écosystème Python : les pratiques de conformité standards s'appliquent.",
      ],
    },
    url: 'https://spdx.org/licenses/PSF-2.0.html',
  },
  'Python-2.0': {
    name: 'Python License 2.0',
    description: {
      en: 'The historical license used for the Python programming language itself. A permissive license that is GPL-compatible and allows free use, modification, and redistribution.',
      fr: "La licence historique utilisée pour le langage de programmation Python lui-même. Une licence permissive compatible GPL qui autorise l'utilisation, la modification et la redistribution libres.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not explicitly address patent rights.',
        'Complex license stack: the full Python license includes references to CNRI and CWI licenses, adding complexity.',
        'Provided "as is" without warranty.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas explicitement les droits de brevet.",
        "Pile de licences complexe : la licence Python complète inclut des références aux licences CNRI et CWI, ajoutant de la complexité.",
        "Fourni « en l'état » sans garantie.",
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Acknowledge the Python Software Foundation.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        'Mentionner la Python Software Foundation.',
      ],
    },
    recommendations: {
      en: [
        'Safe for commercial use: GPL-compatible.',
        'Include the full license text in distributions to cover all historical license layers.',
      ],
      fr: [
        'Utilisation commerciale sûre : compatible GPL.',
        'Inclure le texte complet de la licence dans les distributions pour couvrir toutes les couches de licence historiques.',
      ],
    },
    url: 'https://spdx.org/licenses/Python-2.0.html',
  },
  PostgreSQL: {
    name: 'PostgreSQL License',
    description: {
      en: 'A very permissive license similar to MIT/BSD, used by the PostgreSQL database project. Allows use, modification, and distribution for any purpose.',
      fr: "Une licence très permissive similaire à MIT/BSD, utilisée par le projet de base de données PostgreSQL. Autorise l'utilisation, la modification et la distribution à toute fin.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not address patents.',
        'Provided "as is" without warranty.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas les brevets.",
        "Fourni « en l'état » sans garantie.",
      ],
    },
    obligations: {
      en: ['Include copyright notice and license text.'],
      fr: ["Inclure l'avis de copyright et le texte de la licence."],
    },
    recommendations: {
      en: [
        'Treat identically to MIT: include the license text in distributions.',
        'Safe for commercial and proprietary use.',
      ],
      fr: [
        'Traiter de manière identique à MIT : inclure le texte de la licence dans les distributions.',
        'Utilisation commerciale et propriétaire sans restriction.',
      ],
    },
    url: 'https://spdx.org/licenses/PostgreSQL.html',
  },
  'BlueOak-1.0.0': {
    name: 'Blue Oak Model License 1.0.0',
    description: {
      en: 'A modern permissive license written in plain language with an express patent grant. Designed to be clear and easy to understand while providing strong legal protections.',
      fr: "Une licence permissive moderne rédigée en langage clair avec une concession de brevet expresse. Conçue pour être claire et facile à comprendre tout en offrant de fortes protections juridiques.",
    },
    legalRisks: {
      en: [
        'Express patent grant: provides better patent protection than MIT/BSD.',
        'Relatively new: less case law and community precedent than established licenses like MIT.',
        'Provided "as is" without warranty.',
      ],
      fr: [
        'Concession de brevet expresse : offre une meilleure protection par brevet que MIT/BSD.',
        'Relativement nouvelle : moins de jurisprudence et de précédent communautaire que les licences établies comme MIT.',
        "Fourni « en l'état » sans garantie.",
      ],
    },
    obligations: {
      en: ['Include copyright notice and license text.'],
      fr: ["Inclure l'avis de copyright et le texte de la licence."],
    },
    recommendations: {
      en: [
        'Safe for commercial and proprietary use: the patent grant provides extra protection.',
        'A good alternative to MIT when patent protection is desired.',
        'Include the license text in all distributions.',
      ],
      fr: [
        'Utilisation commerciale et propriétaire sûre : la concession de brevet offre une protection supplémentaire.',
        'Une bonne alternative à MIT lorsque la protection par brevet est souhaitée.',
        'Inclure le texte de la licence dans toutes les distributions.',
      ],
    },
    url: 'https://spdx.org/licenses/BlueOak-1.0.0.html',
  },
  'Artistic-1.0': {
    name: 'Artistic License 1.0',
    description: {
      en: 'A license originally created for the Perl programming language. It allows modifications if they are documented, but its vague terms have caused interpretation issues.',
      fr: "Une licence créée à l'origine pour le langage de programmation Perl. Elle autorise les modifications si elles sont documentées, mais ses termes vagues ont causé des problèmes d'interprétation.",
    },
    legalRisks: {
      en: [
        'Vague terms: the license language is ambiguous, particularly around what constitutes a "Standard Version" vs. a modified version.',
        'No patent grant: does not address patents.',
        'Interpretation risk: the vagueness has led some organizations to avoid it in favor of Artistic-2.0.',
      ],
      fr: [
        "Termes vagues : le langage de la licence est ambigu, particulièrement autour de ce qui constitue une « Version Standard » par rapport à une version modifiée.",
        "Aucune concession de brevet : n'aborde pas les brevets.",
        "Risque d'interprétation : l'imprécision a conduit certaines organisations à l'éviter au profit de l'Artistic-2.0.",
      ],
    },
    obligations: {
      en: [
        'Document modifications made to the software.',
        'Include copyright notice and license text.',
      ],
      fr: [
        'Documenter les modifications apportées au logiciel.',
        "Inclure l'avis de copyright et le texte de la licence.",
      ],
    },
    recommendations: {
      en: [
        'Prefer Artistic-2.0 for clearer terms if possible.',
        'If using Artistic-1.0 dependencies, document any modifications clearly.',
        'Generally safe for commercial use, but review terms carefully.',
      ],
      fr: [
        "Préférer l'Artistic-2.0 pour des termes plus clairs si possible.",
        'Si vous utilisez des dépendances sous Artistic-1.0, documenter clairement toute modification.',
        "Généralement sûr pour l'utilisation commerciale, mais examiner les termes attentivement.",
      ],
    },
    url: 'https://spdx.org/licenses/Artistic-1.0.html',
  },
  'Artistic-2.0': {
    name: 'Artistic License 2.0',
    description: {
      en: 'A clearer rewrite of the Artistic License 1.0, used widely in the Perl ecosystem. Allows use as a dependency freely and permits modifications under defined conditions.',
      fr: "Une réécriture plus claire de l'Artistic License 1.0, largement utilisée dans l'écosystème Perl. Autorise l'utilisation comme dépendance librement et permet les modifications sous des conditions définies.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not address patents.',
        'Modification conditions: modified versions must be clearly documented and distributed under specific terms.',
        'GPL-compatible: can be combined with GPL-licensed code.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas les brevets.",
        'Conditions de modification : les versions modifiées doivent être clairement documentées et distribuées sous des termes spécifiques.',
        'Compatible GPL : peut être combinée avec du code sous GPL.',
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Document modifications if distributing modified versions.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        'Documenter les modifications si vous distribuez des versions modifiées.',
      ],
    },
    recommendations: {
      en: [
        'Safe for use as a dependency without modification: no special compliance needed.',
        'If modifying, review the specific distribution requirements carefully.',
        'Preferred over Artistic-1.0 for its clearer terms.',
      ],
      fr: [
        'Sûr à utiliser comme dépendance sans modification : aucune conformité spéciale requise.',
        'Si vous modifiez, examiner attentivement les exigences de distribution spécifiques.',
        "Préférée à l'Artistic-1.0 pour ses termes plus clairs.",
      ],
    },
    url: 'https://spdx.org/licenses/Artistic-2.0.html',
  },
  'OFL-1.0': {
    name: 'SIL Open Font License 1.0',
    description: {
      en: 'A free and open-source license designed specifically for fonts. Allows use, modification, and redistribution of fonts, but fonts cannot be sold by themselves.',
      fr: "Une licence libre et open-source conçue spécifiquement pour les polices. Autorise l'utilisation, la modification et la redistribution des polices, mais les polices ne peuvent pas être vendues seules.",
    },
    legalRisks: {
      en: [
        'Font-only restriction: fonts under OFL cannot be sold as standalone products.',
        'Reserved Font Names: modified fonts must not use the reserved font names from the original.',
        'Not designed for software: using it for non-font software may cause confusion.',
      ],
      fr: [
        'Restriction aux polices uniquement : les polices sous OFL ne peuvent pas être vendues comme produits autonomes.',
        'Noms de police réservés : les polices modifiées ne doivent pas utiliser les noms de police réservés de l\'original.',
        "Non conçue pour le logiciel : l'utiliser pour du logiciel non-police peut causer de la confusion.",
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text with the fonts.',
        'Do not sell the fonts as a standalone product.',
        'Rename modified fonts if they use reserved names.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence avec les polices.",
        'Ne pas vendre les polices comme produit autonome.',
        "Renommer les polices modifiées si elles utilisent des noms réservés.",
      ],
    },
    recommendations: {
      en: [
        'Safe to bundle fonts with your application or website.',
        'If modifying fonts, ensure you do not use reserved font names.',
        'Prefer OFL-1.1 for newer font projects.',
      ],
      fr: [
        'Sûr de regrouper les polices avec votre application ou site web.',
        "Si vous modifiez les polices, assurez-vous de ne pas utiliser les noms de police réservés.",
        'Préférer OFL-1.1 pour les nouveaux projets de polices.',
      ],
    },
    url: 'https://spdx.org/licenses/OFL-1.0.html',
  },
  'OFL-1.1': {
    name: 'SIL Open Font License 1.1',
    description: {
      en: 'The most common open font license. An updated version of OFL-1.0 with clarified terms. Allows free use, modification, and redistribution of fonts, but they cannot be sold alone.',
      fr: "La licence de police open-source la plus courante. Une version mise à jour de l'OFL-1.0 avec des termes clarifiés. Autorise l'utilisation, la modification et la redistribution libres des polices, mais elles ne peuvent pas être vendues seules.",
    },
    legalRisks: {
      en: [
        'Font-only restriction: fonts cannot be sold as standalone products.',
        'Reserved Font Names: modified fonts must be renamed if using reserved names.',
        'Not designed for software code: only appropriate for font files.',
      ],
      fr: [
        'Restriction aux polices uniquement : les polices ne peuvent pas être vendues comme produits autonomes.',
        'Noms de police réservés : les polices modifiées doivent être renommées si elles utilisent des noms réservés.',
        'Non conçue pour le code logiciel : appropriée uniquement pour les fichiers de police.',
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text with the fonts.',
        'Do not sell fonts as a standalone product.',
        'Rename modified fonts if they use reserved names.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence avec les polices.",
        'Ne pas vendre les polices comme produit autonome.',
        'Renommer les polices modifiées si elles utilisent des noms réservés.',
      ],
    },
    recommendations: {
      en: [
        'Safe to use and bundle fonts in any project.',
        'The most widely adopted font license: well understood by legal teams.',
        'If modifying fonts, choose new names that do not conflict with reserved names.',
      ],
      fr: [
        'Sûr d\'utiliser et de regrouper les polices dans tout projet.',
        'La licence de police la plus largement adoptée : bien comprise par les équipes juridiques.',
        'Si vous modifiez les polices, choisir de nouveaux noms qui ne rentrent pas en conflit avec les noms réservés.',
      ],
    },
    url: 'https://spdx.org/licenses/OFL-1.1.html',
  },
  'AFL-2.0': {
    name: 'Academic Free License 2.0',
    description: {
      en: 'A permissive open-source license with an express patent grant, originally designed for academic use. Allows free use, modification, and redistribution.',
      fr: "Une licence open-source permissive avec une concession de brevet expresse, conçue à l'origine pour un usage académique. Autorise l'utilisation, la modification et la redistribution libres.",
    },
    legalRisks: {
      en: [
        'Patent retaliation clause: patent litigation related to the software terminates your license.',
        'Less commonly used: less community review and legal precedent than MIT or Apache-2.0.',
        'Provided "as is" without warranty.',
      ],
      fr: [
        'Clause de rétorsion de brevet : un litige de brevet lié au logiciel résilie votre licence.',
        'Moins couramment utilisée : moins de révision communautaire et de précédent juridique que MIT ou Apache-2.0.',
        "Fourni « en l'état » sans garantie.",
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Provide attribution to the original author.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        "Fournir l'attribution à l'auteur original.",
      ],
    },
    recommendations: {
      en: [
        'Safe for commercial and proprietary use: includes patent grant.',
        'If patent protection is important, AFL provides it similarly to Apache-2.0.',
        'Prefer AFL-3.0 for newer projects with clearer terms.',
      ],
      fr: [
        'Utilisation commerciale et propriétaire sûre : inclut une concession de brevet.',
        'Si la protection par brevet est importante, l\'AFL la fournit de manière similaire à Apache-2.0.',
        'Préférer AFL-3.0 pour les nouveaux projets avec des termes plus clairs.',
      ],
    },
    url: 'https://spdx.org/licenses/AFL-2.0.html',
  },
  'AFL-2.1': {
    name: 'Academic Free License 2.1',
    description: {
      en: 'A minor update to AFL-2.0 with refined language. A permissive license with express patent grant, suitable for academic and commercial use.',
      fr: "Une mise à jour mineure de l'AFL-2.0 avec un langage affiné. Une licence permissive avec concession de brevet expresse, adaptée à l'usage académique et commercial.",
    },
    legalRisks: {
      en: [
        'Patent retaliation clause: patent litigation terminates your license.',
        'Less commonly used: limited legal precedent compared to mainstream licenses.',
        'Provided "as is" without warranty.',
      ],
      fr: [
        'Clause de rétorsion de brevet : un litige de brevet résilie votre licence.',
        'Moins couramment utilisée : précédent juridique limité comparé aux licences principales.',
        "Fourni « en l'état » sans garantie.",
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Provide attribution to the original author.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        "Fournir l'attribution à l'auteur original.",
      ],
    },
    recommendations: {
      en: [
        'Safe for commercial and proprietary use.',
        'Prefer AFL-3.0 for clearer and more up-to-date terms.',
      ],
      fr: [
        'Utilisation commerciale et propriétaire sûre.',
        'Préférer AFL-3.0 pour des termes plus clairs et à jour.',
      ],
    },
    url: 'https://spdx.org/licenses/AFL-2.1.html',
  },
  'AFL-3.0': {
    name: 'Academic Free License 3.0',
    description: {
      en: 'The latest version of the Academic Free License with clearer terms and an express patent grant. A permissive license suitable for both academic and commercial use.',
      fr: "La dernière version de l'Academic Free License avec des termes plus clairs et une concession de brevet expresse. Une licence permissive adaptée à l'usage académique et commercial.",
    },
    legalRisks: {
      en: [
        'Patent retaliation clause: patent litigation related to the software terminates your license.',
        'Less commonly used: fewer precedents than MIT or Apache-2.0.',
        'Provided "as is" without warranty.',
      ],
      fr: [
        'Clause de rétorsion de brevet : un litige de brevet lié au logiciel résilie votre licence.',
        'Moins couramment utilisée : moins de précédents que MIT ou Apache-2.0.',
        "Fourni « en l'état » sans garantie.",
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Provide attribution to the original author.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        "Fournir l'attribution à l'auteur original.",
      ],
    },
    recommendations: {
      en: [
        'Safe for commercial and proprietary use: the patent grant provides additional protection.',
        'Preferred over AFL-2.0 and AFL-2.1 for its improved clarity.',
        'Include the full license text in all distributions.',
      ],
      fr: [
        'Utilisation commerciale et propriétaire sûre : la concession de brevet offre une protection supplémentaire.',
        "Préférée à l'AFL-2.0 et l'AFL-2.1 pour sa clarté améliorée.",
        'Inclure le texte complet de la licence dans toutes les distributions.',
      ],
    },
    url: 'https://spdx.org/licenses/AFL-3.0.html',
  },
  NCSA: {
    name: 'University of Illinois/NCSA Open Source License',
    description: {
      en: 'A permissive license that combines elements of MIT and BSD 3-Clause licenses. Allows free use, modification, and redistribution with copyright notice and disclaimer requirements.',
      fr: "Une licence permissive qui combine des éléments des licences MIT et BSD 3-Clause. Autorise l'utilisation, la modification et la redistribution libres avec des exigences de mention de copyright et de clause de non-responsabilité.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not address patent rights.',
        'Non-endorsement clause: same as BSD-3-Clause.',
        'Provided "as is" without warranty.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas les droits de brevet.",
        'Clause de non-recommandation : identique à BSD-3-Clause.',
        "Fourni « en l'état » sans garantie.",
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Do not use contributor names for endorsement without permission.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        'Ne pas utiliser les noms des contributeurs pour des recommandations sans permission.',
      ],
    },
    recommendations: {
      en: [
        'Treat similarly to BSD-3-Clause: include the license text in distributions.',
        'Safe for commercial and proprietary use.',
      ],
      fr: [
        'Traiter de manière similaire à BSD-3-Clause : inclure le texte de la licence dans les distributions.',
        'Utilisation commerciale et propriétaire sans restriction.',
      ],
    },
    url: 'https://spdx.org/licenses/NCSA.html',
  },
  'MS-PL': {
    name: 'Microsoft Public License',
    description: {
      en: 'A permissive open-source license from Microsoft that includes an express patent grant. Allows use, modification, and redistribution under minimal conditions.',
      fr: "Une licence open-source permissive de Microsoft qui inclut une concession de brevet expresse. Autorise l'utilisation, la modification et la redistribution sous des conditions minimales.",
    },
    legalRisks: {
      en: [
        'Patent grant included: provides protection, but patent retaliation clause terminates rights if you sue.',
        'Platform restriction ambiguity: some interpretations suggest restrictions on Windows-specific implementations.',
        'Less commonly used: fewer precedents than MIT or Apache-2.0.',
      ],
      fr: [
        'Concession de brevet incluse : offre une protection, mais la clause de rétorsion de brevet résilie les droits si vous poursuivez.',
        "Ambiguïté de restriction de plateforme : certaines interprétations suggèrent des restrictions sur les implémentations spécifiques à Windows.",
        'Moins couramment utilisée : moins de précédents que MIT ou Apache-2.0.',
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Retain all notices in the source code.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        'Conserver toutes les mentions dans le code source.',
      ],
    },
    recommendations: {
      en: [
        'Safe for commercial and proprietary use.',
        'The patent grant provides additional protection compared to MIT/BSD.',
        'Include the license text in all distributions.',
      ],
      fr: [
        'Utilisation commerciale et propriétaire sûre.',
        'La concession de brevet offre une protection supplémentaire comparée à MIT/BSD.',
        'Inclure le texte de la licence dans toutes les distributions.',
      ],
    },
    url: 'https://spdx.org/licenses/MS-PL.html',
  },
  JSON: {
    name: 'JSON License',
    description: {
      en: 'A MIT-like license with the additional clause "The Software shall be used for Good, not Evil." This clause makes it non-free according to the FSF and Debian.',
      fr: "Une licence similaire à MIT avec la clause additionnelle « Le Logiciel doit être utilisé pour le Bien, pas le Mal ». Cette clause la rend non-libre selon la FSF et Debian.",
    },
    legalRisks: {
      en: [
        '"Good, not Evil" clause: this vague restriction creates legal uncertainty; its enforceability and interpretation are untested in court.',
        'Not considered free/open-source: the FSF, Debian, and some other organizations classify it as non-free due to the use restriction.',
        'No patent grant: does not address patents.',
        'May conflict with organizational open-source policies that require OSI-approved licenses.',
      ],
      fr: [
        "Clause « Bien, pas Mal » : cette restriction vague crée une incertitude juridique ; son applicabilité et son interprétation n'ont pas été testées en justice.",
        "Non considérée comme libre/open-source : la FSF, Debian et certaines autres organisations la classifient comme non-libre en raison de la restriction d'utilisation.",
        "Aucune concession de brevet : n'aborde pas les brevets.",
        "Peut entrer en conflit avec les politiques open-source organisationnelles qui exigent des licences approuvées par l'OSI.",
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Use the software "for Good, not Evil" (interpretation unclear).',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        'Utiliser le logiciel « pour le Bien, pas le Mal » (interprétation incertaine).',
      ],
    },
    recommendations: {
      en: [
        'Evaluate whether the "Good, not Evil" clause is acceptable under your compliance policies.',
        'Some organizations explicitly ban this license: check your allowlist.',
        'If concerned, look for alternatives under MIT or BSD licenses.',
      ],
      fr: [
        'Évaluer si la clause « Bien, pas Mal » est acceptable selon vos politiques de conformité.',
        'Certaines organisations interdisent explicitement cette licence : vérifier votre liste autorisée.',
        'En cas de doute, chercher des alternatives sous licences MIT ou BSD.',
      ],
    },
    url: 'https://spdx.org/licenses/JSON.html',
  },
  W3C: {
    name: 'W3C Software Notice and License',
    description: {
      en: 'A permissive license used by the World Wide Web Consortium for its software and specifications. Allows use, modification, and redistribution with notice requirements.',
      fr: "Une licence permissive utilisée par le World Wide Web Consortium pour ses logiciels et spécifications. Autorise l'utilisation, la modification et la redistribution avec des exigences de mention.",
    },
    legalRisks: {
      en: [
        'No patent grant: does not address patent rights.',
        'Provided "as is" without warranty.',
        'W3C-specific terms: less commonly reviewed outside web standards context.',
      ],
      fr: [
        "Aucune concession de brevet : n'aborde pas les droits de brevet.",
        "Fourni « en l'état » sans garantie.",
        'Termes spécifiques au W3C : moins couramment examinés en dehors du contexte des standards web.',
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Include the status of modifications if changes were made.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        'Inclure le statut des modifications si des changements ont été apportés.',
      ],
    },
    recommendations: {
      en: [
        'Safe for commercial and proprietary use.',
        'Common in web standards implementations: standard compliance practices apply.',
      ],
      fr: [
        'Utilisation commerciale et propriétaire sûre.',
        "Courante dans les implémentations de standards web : les pratiques de conformité standards s'appliquent.",
      ],
    },
    url: 'https://spdx.org/licenses/W3C.html',
  },
  'PHP-3.0': {
    name: 'PHP License v3.0',
    description: {
      en: 'The license used for the PHP programming language. A permissive license that restricts the use of the "PHP" name in derived products without permission.',
      fr: "La licence utilisée pour le langage de programmation PHP. Une licence permissive qui restreint l'utilisation du nom « PHP » dans les produits dérivés sans permission.",
    },
    legalRisks: {
      en: [
        'Name restriction: products derived from PHP must not use "PHP" in their names without permission from the PHP Group.',
        'No patent grant: does not address patent rights.',
        'PHP-specific: designed for the PHP project itself, not general-purpose use.',
      ],
      fr: [
        "Restriction de nom : les produits dérivés de PHP ne doivent pas utiliser « PHP » dans leurs noms sans permission du PHP Group.",
        "Aucune concession de brevet : n'aborde pas les droits de brevet.",
        "Spécifique à PHP : conçue pour le projet PHP lui-même, pas pour un usage général.",
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Do not use "PHP" name in derived products without permission.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        'Ne pas utiliser le nom « PHP » dans les produits dérivés sans permission.',
      ],
    },
    recommendations: {
      en: [
        'Safe for use within the PHP ecosystem.',
        'Avoid using "PHP" in the name of any derived product.',
        'For non-PHP projects, prefer standard permissive licenses like MIT.',
      ],
      fr: [
        "Sûr à utiliser dans l'écosystème PHP.",
        'Éviter d\'utiliser « PHP » dans le nom de tout produit dérivé.',
        'Pour les projets non-PHP, préférer les licences permissives standards comme MIT.',
      ],
    },
    url: 'https://spdx.org/licenses/PHP-3.0.html',
  },
  'PHP-3.01': {
    name: 'PHP License v3.01',
    description: {
      en: 'A minor update to PHP License v3.0 with refined language. Same permissive terms with restrictions on the use of the "PHP" name.',
      fr: "Une mise à jour mineure de la PHP License v3.0 avec un langage affiné. Mêmes termes permissifs avec des restrictions sur l'utilisation du nom « PHP ».",
    },
    legalRisks: {
      en: [
        'Name restriction: same as PHP-3.0, products must not use "PHP" in their names without permission.',
        'No patent grant: does not address patent rights.',
        'PHP-specific: not intended for general-purpose licensing.',
      ],
      fr: [
        "Restriction de nom : identique à PHP-3.0, les produits ne doivent pas utiliser « PHP » dans leurs noms sans permission.",
        "Aucune concession de brevet : n'aborde pas les droits de brevet.",
        "Spécifique à PHP : non destinée à une utilisation de licence à usage général.",
      ],
    },
    obligations: {
      en: [
        'Include copyright notice and license text.',
        'Do not use "PHP" name in derived products without permission.',
      ],
      fr: [
        "Inclure l'avis de copyright et le texte de la licence.",
        'Ne pas utiliser le nom « PHP » dans les produits dérivés sans permission.',
      ],
    },
    recommendations: {
      en: [
        'Same compliance as PHP-3.0: avoid using "PHP" in derived product names.',
        'Safe for commercial use within the PHP ecosystem.',
      ],
      fr: [
        'Même conformité que PHP-3.0 : éviter d\'utiliser « PHP » dans les noms de produits dérivés.',
        "Utilisation commerciale sûre dans l'écosystème PHP.",
      ],
    },
    url: 'https://spdx.org/licenses/PHP-3.01.html',
  },
  'CC-BY-SA-4.0': {
    name: 'Creative Commons Attribution ShareAlike 4.0',
    description: {
      en: 'A Creative Commons license requiring attribution and that derivative works be distributed under the same or a compatible license (ShareAlike). Designed for content, not software.',
      fr: "Une licence Creative Commons exigeant l'attribution et que les œuvres dérivées soient distribuées sous la même licence ou une licence compatible (Partage à l'identique). Conçue pour le contenu, pas le logiciel.",
    },
    legalRisks: {
      en: [
        'ShareAlike copyleft: derivative works must be licensed under CC-BY-SA-4.0 or a compatible license, which limits how derivatives can be relicensed.',
        'Not designed for software: does not address patents or software-specific concerns.',
        'Attribution complexity: must credit the original author in the manner specified.',
        'Viral effect on content: incorporating CC-BY-SA content into larger works may require the entire work to be CC-BY-SA.',
      ],
      fr: [
        "Copyleft Partage à l'identique : les œuvres dérivées doivent être sous licence CC-BY-SA-4.0 ou une licence compatible, ce qui limite la re-licence des dérivés.",
        "Non conçue pour le logiciel : n'aborde pas les brevets ni les préoccupations spécifiques au logiciel.",
        "Complexité d'attribution : il faut créditer l'auteur original de la manière spécifiée.",
        "Effet viral sur le contenu : incorporer du contenu CC-BY-SA dans des œuvres plus larges peut exiger que l'ensemble de l'œuvre soit sous CC-BY-SA.",
      ],
    },
    obligations: {
      en: [
        'Provide attribution to the original author.',
        'License derivative works under CC-BY-SA-4.0 or a compatible license.',
        'Indicate if changes were made.',
        'Include a link to the license.',
      ],
      fr: [
        "Fournir l'attribution à l'auteur original.",
        "Licencier les œuvres dérivées sous CC-BY-SA-4.0 ou une licence compatible.",
        'Indiquer si des modifications ont été apportées.',
        'Inclure un lien vers la licence.',
      ],
    },
    recommendations: {
      en: [
        'Use only for documentation, media, and data: not for software source code.',
        'Be aware that the ShareAlike clause applies to derivative works.',
        'If combining with other content, verify license compatibility.',
      ],
      fr: [
        'Utiliser uniquement pour la documentation, les médias et les données : pas pour le code source logiciel.',
        "Savoir que la clause Partage à l'identique s'applique aux œuvres dérivées.",
        'Si vous combinez avec d\'autre contenu, vérifier la compatibilité des licences.',
      ],
    },
    url: 'https://spdx.org/licenses/CC-BY-SA-4.0.html',
  },
  'LGPL-2.0-only': {
    name: 'GNU Library General Public License v2.0',
    description: {
      en: 'The predecessor of LGPL-2.1, originally called the "Library General Public License." A weak copyleft license that allows linking to proprietary software, but modifications to the library itself must be open-sourced.',
      fr: "Le prédécesseur de la LGPL-2.1, appelée à l'origine « Library General Public License ». Une licence copyleft faible qui permet le lien avec des logiciels propriétaires, mais les modifications de la bibliothèque elle-même doivent être open-sourcées.",
    },
    legalRisks: {
      en: [
        'Static linking risk: statically linking may trigger copyleft obligations on the entire binary.',
        'Modification disclosure: modifications to the library must be released under LGPL.',
        'Reverse engineering clause: must allow users to reverse-engineer for debugging the linked library.',
        'Largely superseded by LGPL-2.1: less legal precedent for this version specifically.',
      ],
      fr: [
        "Risque de liaison statique : la liaison statique peut déclencher des obligations copyleft sur l'ensemble du binaire.",
        'Divulgation des modifications : les modifications de la bibliothèque doivent être publiées sous LGPL.',
        'Clause de rétro-ingénierie : il faut permettre aux utilisateurs de faire de la rétro-ingénierie pour déboguer la bibliothèque liée.',
        'Largement remplacée par la LGPL-2.1 : moins de précédent juridique pour cette version spécifiquement.',
      ],
    },
    obligations: {
      en: [
        'Disclose source of modifications to the library.',
        'Allow reverse engineering for debugging.',
        'Include copyright and license notices.',
        'Provide mechanism for users to re-link with modified library (if statically linked).',
      ],
      fr: [
        'Divulguer le code source des modifications de la bibliothèque.',
        'Permettre la rétro-ingénierie pour le débogage.',
        'Inclure les avis de copyright et de licence.',
        'Fournir un mécanisme permettant aux utilisateurs de re-lier avec une bibliothèque modifiée (si liaison statique).',
      ],
    },
    recommendations: {
      en: [
        'Use dynamic linking to avoid triggering copyleft on your proprietary code.',
        'Consider migrating to dependencies under LGPL-2.1 or LGPL-3.0 if possible.',
        'Do not modify the library source unless you are prepared to disclose those changes.',
      ],
      fr: [
        'Utiliser la liaison dynamique pour éviter de déclencher le copyleft sur votre code propriétaire.',
        'Envisager de migrer vers des dépendances sous LGPL-2.1 ou LGPL-3.0 si possible.',
        "Ne pas modifier le code source de la bibliothèque sauf si vous êtes prêt à divulguer ces changements.",
      ],
    },
    url: 'https://spdx.org/licenses/LGPL-2.0-only.html',
  },
  'LGPL-2.0-or-later': {
    name: 'GNU Library General Public License v2.0 or later',
    description: {
      en: 'Same obligations as LGPL-2.0-only, but the licensee can choose to comply with the terms of any later version of the LGPL. This provides flexibility to adopt improvements in newer LGPL versions.',
      fr: "Mêmes obligations que la LGPL-2.0-only, mais le licencié peut choisir de se conformer aux termes de toute version ultérieure de la LGPL. Cela offre la flexibilité d'adopter les améliorations des versions LGPL plus récentes.",
    },
    legalRisks: {
      en: [
        'Static linking risk: same as LGPL-2.0, statically linking may trigger copyleft obligations.',
        'Version flexibility: the "or later" clause means the licensee can choose a newer LGPL version, which may have different terms (e.g., LGPL-3.0 adds anti-tivoization).',
        'Modification disclosure: modifications must be released under LGPL.',
      ],
      fr: [
        'Risque de liaison statique : identique à la LGPL-2.0, la liaison statique peut déclencher des obligations copyleft.',
        'Flexibilité de version : la clause « ou ultérieure » signifie que le licencié peut choisir une version LGPL plus récente, qui peut avoir des termes différents (ex. la LGPL-3.0 ajoute l\'anti-tivoisation).',
        'Divulgation des modifications : les modifications doivent être publiées sous LGPL.',
      ],
    },
    obligations: {
      en: [
        'Disclose source of modifications to the library.',
        'Allow reverse engineering for debugging.',
        'Include copyright and license notices.',
        'Provide mechanism for re-linking (if statically linked).',
      ],
      fr: [
        'Divulguer le code source des modifications de la bibliothèque.',
        'Permettre la rétro-ingénierie pour le débogage.',
        'Inclure les avis de copyright et de licence.',
        'Fournir un mécanisme de re-liaison (si liaison statique).',
      ],
    },
    recommendations: {
      en: [
        'Use dynamic linking to minimize copyleft impact on proprietary code.',
        'The "or later" clause gives you the option to comply with LGPL-2.1 or LGPL-3.0 terms if preferred.',
        'Do not modify the library source unless you are prepared to disclose changes.',
      ],
      fr: [
        'Utiliser la liaison dynamique pour minimiser l\'impact copyleft sur le code propriétaire.',
        'La clause « ou ultérieure » vous donne la possibilité de vous conformer aux termes de la LGPL-2.1 ou LGPL-3.0 si préféré.',
        'Ne pas modifier le code source de la bibliothèque sauf si vous êtes prêt à divulguer les changements.',
      ],
    },
    url: 'https://spdx.org/licenses/LGPL-2.0-or-later.html',
  },
  'LGPL-2.1-or-later': {
    name: 'GNU Lesser General Public License v2.1 or later',
    description: {
      en: 'Same obligations as LGPL-2.1-only, but the licensee can choose to comply with any later version of the LGPL. This allows adopting newer LGPL terms such as LGPL-3.0.',
      fr: "Mêmes obligations que la LGPL-2.1-only, mais le licencié peut choisir de se conformer à toute version ultérieure de la LGPL. Cela permet d'adopter des termes LGPL plus récents comme la LGPL-3.0.",
    },
    legalRisks: {
      en: [
        'Static linking risk: statically linking may trigger copyleft obligations on the entire binary.',
        'Version flexibility: the "or later" clause allows the licensee to choose LGPL-3.0 terms, which include anti-tivoization provisions.',
        'Modification disclosure: modifications to the library must be released under LGPL.',
        'Reverse engineering clause: must allow reverse engineering for debugging.',
      ],
      fr: [
        "Risque de liaison statique : la liaison statique peut déclencher des obligations copyleft sur l'ensemble du binaire.",
        "Flexibilité de version : la clause « ou ultérieure » permet au licencié de choisir les termes de la LGPL-3.0, qui incluent des dispositions anti-tivoisation.",
        'Divulgation des modifications : les modifications de la bibliothèque doivent être publiées sous LGPL.',
        'Clause de rétro-ingénierie : il faut permettre la rétro-ingénierie pour le débogage.',
      ],
    },
    obligations: {
      en: [
        'Disclose source of modifications to the library.',
        'Allow reverse engineering for debugging.',
        'Include copyright and license notices.',
        'Provide mechanism for re-linking (if statically linked).',
      ],
      fr: [
        'Divulguer le code source des modifications de la bibliothèque.',
        'Permettre la rétro-ingénierie pour le débogage.',
        'Inclure les avis de copyright et de licence.',
        'Fournir un mécanisme de re-liaison (si liaison statique).',
      ],
    },
    recommendations: {
      en: [
        'Use dynamic linking to avoid triggering copyleft on your proprietary code.',
        'The "or later" clause gives flexibility to adopt LGPL-3.0 terms if beneficial.',
        'Do not modify the library source unless prepared to disclose changes under LGPL.',
      ],
      fr: [
        'Utiliser la liaison dynamique pour éviter de déclencher le copyleft sur votre code propriétaire.',
        'La clause « ou ultérieure » offre la flexibilité d\'adopter les termes de la LGPL-3.0 si avantageux.',
        'Ne pas modifier le code source de la bibliothèque sauf si vous êtes prêt à divulguer les changements sous LGPL.',
      ],
    },
    url: 'https://spdx.org/licenses/LGPL-2.1-or-later.html',
  },
  'LGPL-3.0-or-later': {
    name: 'GNU Lesser General Public License v3.0 or later',
    description: {
      en: 'Same obligations as LGPL-3.0-only, but the licensee can choose to comply with any later version of the LGPL. Provides flexibility to adopt future LGPL improvements.',
      fr: "Mêmes obligations que la LGPL-3.0-only, mais le licencié peut choisir de se conformer à toute version ultérieure de la LGPL. Offre la flexibilité d'adopter les améliorations futures de la LGPL.",
    },
    legalRisks: {
      en: [
        'Static linking risk: same as LGPL-3.0, statically linking may trigger copyleft on the combined work.',
        'Anti-tivoization clause: must provide installation instructions for modified versions on target hardware.',
        'Patent retaliation: patent claims related to the software terminate your license.',
        'Version flexibility: future LGPL versions may introduce additional obligations.',
      ],
      fr: [
        'Risque de liaison statique : identique à la LGPL-3.0, la liaison statique peut déclencher le copyleft sur le travail combiné.',
        "Clause anti-tivoisation : il faut fournir les instructions d'installation pour les versions modifiées sur le matériel cible.",
        'Rétorsion de brevet : les revendications de brevet liées au logiciel résilient votre licence.',
        'Flexibilité de version : les futures versions LGPL peuvent introduire des obligations supplémentaires.',
      ],
    },
    obligations: {
      en: [
        'Disclose source of modifications to the library.',
        'Allow reverse engineering for debugging.',
        'Include copyright and license notices.',
        'Provide installation instructions for modified versions.',
      ],
      fr: [
        'Divulguer le code source des modifications de la bibliothèque.',
        'Permettre la rétro-ingénierie pour le débogage.',
        'Inclure les avis de copyright et de licence.',
        "Fournir les instructions d'installation pour les versions modifiées.",
      ],
    },
    recommendations: {
      en: [
        'Use dynamic linking to minimize copyleft impact on proprietary code.',
        'The "or later" clause provides future flexibility: evaluate whether this is beneficial for your project.',
        'Avoid modifying the library source: use it as-is whenever possible.',
      ],
      fr: [
        "Utiliser la liaison dynamique pour minimiser l'impact copyleft sur le code propriétaire.",
        'La clause « ou ultérieure » offre une flexibilité future : évaluer si cela est bénéfique pour votre projet.',
        "Éviter de modifier le code source de la bibliothèque : l'utiliser tel quel autant que possible.",
      ],
    },
    url: 'https://spdx.org/licenses/LGPL-3.0-or-later.html',
  },
  'MPL-1.0': {
    name: 'Mozilla Public License 1.0',
    description: {
      en: 'The original Mozilla Public License. A file-level copyleft license that requires modifications to MPL-licensed files to be disclosed, but allows combining with proprietary code. More complex than MPL-2.0.',
      fr: "La licence Mozilla Public License originale. Une licence copyleft au niveau du fichier qui exige la divulgation des modifications de fichiers sous MPL, mais permet la combinaison avec du code propriétaire. Plus complexe que la MPL-2.0.",
    },
    legalRisks: {
      en: [
        'File-level copyleft: modifications to MPL-licensed files must be disclosed under MPL.',
        'More complex than MPL-2.0: the original version has more verbose and harder-to-interpret terms.',
        'GPL-incompatible: unlike MPL-2.0, version 1.0 is not compatible with GPL by default.',
      ],
      fr: [
        'Copyleft au niveau du fichier : les modifications de fichiers sous MPL doivent être divulguées sous MPL.',
        'Plus complexe que la MPL-2.0 : la version originale a des termes plus verbeux et difficiles à interpréter.',
        "Incompatible avec la GPL : contrairement à la MPL-2.0, la version 1.0 n'est pas compatible avec la GPL par défaut.",
      ],
    },
    obligations: {
      en: [
        'Disclose source code of modified MPL-licensed files.',
        'Include copyright and license notices.',
        'Modifications to MPL files must stay under MPL.',
      ],
      fr: [
        'Divulguer le code source des fichiers MPL modifiés.',
        'Inclure les avis de copyright et de licence.',
        'Les modifications de fichiers MPL doivent rester sous MPL.',
      ],
    },
    recommendations: {
      en: [
        'Prefer dependencies under MPL-2.0 which has clearer and more modern terms.',
        'If you do not modify MPL-licensed files, you can use them freely in proprietary projects.',
        'Do not combine with GPL-licensed code without careful license analysis.',
      ],
      fr: [
        'Préférer les dépendances sous MPL-2.0 qui a des termes plus clairs et modernes.',
        'Si vous ne modifiez pas les fichiers sous MPL, vous pouvez les utiliser librement dans des projets propriétaires.',
        'Ne pas combiner avec du code sous GPL sans une analyse de licence minutieuse.',
      ],
    },
    url: 'https://spdx.org/licenses/MPL-1.0.html',
  },
  'MPL-1.1': {
    name: 'Mozilla Public License 1.1',
    description: {
      en: 'An intermediate version of the Mozilla Public License that added multi-licensing provisions. File-level copyleft with improved flexibility over MPL-1.0.',
      fr: "Une version intermédiaire de la Mozilla Public License qui a ajouté des dispositions de multi-licence. Copyleft au niveau du fichier avec une flexibilité améliorée par rapport à la MPL-1.0.",
    },
    legalRisks: {
      en: [
        'File-level copyleft: modifications to MPL-licensed files must be disclosed under MPL.',
        'Multi-licensing complexity: allows dual/triple licensing which adds compliance analysis overhead.',
        'Largely superseded by MPL-2.0: fewer resources available for compliance guidance.',
      ],
      fr: [
        'Copyleft au niveau du fichier : les modifications de fichiers sous MPL doivent être divulguées sous MPL.',
        "Complexité de multi-licence : autorise la double/triple licence ce qui ajoute une charge d'analyse de conformité.",
        'Largement remplacée par la MPL-2.0 : moins de ressources disponibles pour les conseils de conformité.',
      ],
    },
    obligations: {
      en: [
        'Disclose source code of modified MPL-licensed files.',
        'Include copyright and license notices.',
        'Modifications to MPL files must stay under MPL.',
      ],
      fr: [
        'Divulguer le code source des fichiers MPL modifiés.',
        'Inclure les avis de copyright et de licence.',
        'Les modifications de fichiers MPL doivent rester sous MPL.',
      ],
    },
    recommendations: {
      en: [
        'Prefer MPL-2.0 for new projects: it has clearer terms and GPL compatibility.',
        'If not modifying MPL files, they can be used freely in proprietary projects.',
        'Review multi-licensing options if the project offers them.',
      ],
      fr: [
        'Préférer la MPL-2.0 pour les nouveaux projets : elle a des termes plus clairs et la compatibilité GPL.',
        'Si vous ne modifiez pas les fichiers MPL, ils peuvent être utilisés librement dans des projets propriétaires.',
        'Examiner les options de multi-licence si le projet les offre.',
      ],
    },
    url: 'https://spdx.org/licenses/MPL-1.1.html',
  },
  'EPL-1.0': {
    name: 'Eclipse Public License 1.0',
    description: {
      en: 'The predecessor of EPL-2.0. A weak copyleft license with module-level copyleft obligations. Modifications must be shared, but combining with proprietary modules is allowed.',
      fr: "Le prédécesseur de l'EPL-2.0. Une licence copyleft faible avec des obligations copyleft au niveau du module. Les modifications doivent être partagées, mais la combinaison avec des modules propriétaires est autorisée.",
    },
    legalRisks: {
      en: [
        'Module-level copyleft: modifications to EPL-licensed modules must be disclosed.',
        'Patent retaliation clause: patent litigation related to the software terminates your rights.',
        'GPL-incompatible: unlike EPL-2.0, version 1.0 does not include a GPL secondary license option.',
        'Choice of law provisions: disputes governed by the law of the State of New York.',
      ],
      fr: [
        'Copyleft au niveau du module : les modifications des modules sous EPL doivent être divulguées.',
        'Clause de rétorsion de brevet : un litige de brevet lié au logiciel résilie vos droits.',
        "Incompatible avec la GPL : contrairement à l'EPL-2.0, la version 1.0 n'inclut pas d'option de licence secondaire GPL.",
        "Clauses de choix de loi : les litiges sont régis par la loi de l'État de New York.",
      ],
    },
    obligations: {
      en: [
        'Disclose source of modifications to EPL-licensed modules.',
        'Include copyright and license notices.',
      ],
      fr: [
        'Divulguer le code source des modifications des modules sous EPL.',
        'Inclure les avis de copyright et de licence.',
      ],
    },
    recommendations: {
      en: [
        'Prefer EPL-2.0 dependencies which have clearer terms and GPL compatibility options.',
        'If using unmodified EPL modules as dependencies, no source disclosure is required.',
        'If modifying EPL code, publish changes under EPL-1.0.',
      ],
      fr: [
        "Préférer les dépendances sous EPL-2.0 qui ont des termes plus clairs et des options de compatibilité GPL.",
        "Si vous utilisez des modules EPL non modifiés comme dépendances, aucune divulgation de source n'est requise.",
        'Si vous modifiez du code sous EPL, publiez les changements sous EPL-1.0.',
      ],
    },
    url: 'https://spdx.org/licenses/EPL-1.0.html',
  },
  'CDDL-1.0': {
    name: 'Common Development and Distribution License 1.0',
    description: {
      en: 'A file-level copyleft license created by Sun Microsystems (now Oracle). Modifications to CDDL-licensed files must be disclosed, but combining with proprietary code is allowed. GPL-incompatible.',
      fr: "Une licence copyleft au niveau du fichier créée par Sun Microsystems (maintenant Oracle). Les modifications de fichiers sous CDDL doivent être divulguées, mais la combinaison avec du code propriétaire est autorisée. Incompatible avec la GPL.",
    },
    legalRisks: {
      en: [
        'File-level copyleft: modifications to CDDL-licensed files must be disclosed under CDDL.',
        'GPL-incompatible: CDDL code cannot be combined with GPL-licensed code in the same binary.',
        'Patent retaliation clause: patent litigation terminates your license.',
        'Choice of law provisions: governed by California law.',
      ],
      fr: [
        'Copyleft au niveau du fichier : les modifications de fichiers sous CDDL doivent être divulguées sous CDDL.',
        'Incompatible avec la GPL : le code CDDL ne peut pas être combiné avec du code sous GPL dans le même binaire.',
        'Clause de rétorsion de brevet : un litige de brevet résilie votre licence.',
        'Clauses de choix de loi : régi par la loi californienne.',
      ],
    },
    obligations: {
      en: [
        'Disclose source code of modified CDDL-licensed files.',
        'Include copyright and license notices.',
        'Modifications to CDDL files must stay under CDDL.',
      ],
      fr: [
        'Divulguer le code source des fichiers CDDL modifiés.',
        'Inclure les avis de copyright et de licence.',
        'Les modifications de fichiers CDDL doivent rester sous CDDL.',
      ],
    },
    recommendations: {
      en: [
        'If not modifying CDDL files, you can use them freely in proprietary projects.',
        'Do not combine CDDL code with GPL code in the same project.',
        'If modifying CDDL files, publish the changes under CDDL.',
      ],
      fr: [
        'Si vous ne modifiez pas les fichiers CDDL, vous pouvez les utiliser librement dans des projets propriétaires.',
        'Ne pas combiner du code CDDL avec du code GPL dans le même projet.',
        'Si vous modifiez les fichiers CDDL, publiez les changements sous CDDL.',
      ],
    },
    url: 'https://spdx.org/licenses/CDDL-1.0.html',
  },
  'CDDL-1.1': {
    name: 'Common Development and Distribution License 1.1',
    description: {
      en: 'A minor update to CDDL-1.0 with refined language. Same file-level copyleft obligations apply. GPL-incompatible.',
      fr: "Une mise à jour mineure de la CDDL-1.0 avec un langage affiné. Mêmes obligations copyleft au niveau du fichier. Incompatible avec la GPL.",
    },
    legalRisks: {
      en: [
        'File-level copyleft: modifications to CDDL files must be disclosed under CDDL.',
        'GPL-incompatible: cannot combine with GPL-licensed code.',
        'Patent retaliation clause: patent litigation terminates your license.',
      ],
      fr: [
        'Copyleft au niveau du fichier : les modifications de fichiers CDDL doivent être divulguées sous CDDL.',
        'Incompatible avec la GPL : ne peut pas être combinée avec du code sous GPL.',
        'Clause de rétorsion de brevet : un litige de brevet résilie votre licence.',
      ],
    },
    obligations: {
      en: [
        'Disclose source code of modified CDDL-licensed files.',
        'Include copyright and license notices.',
        'Modifications to CDDL files must stay under CDDL.',
      ],
      fr: [
        'Divulguer le code source des fichiers CDDL modifiés.',
        'Inclure les avis de copyright et de licence.',
        'Les modifications de fichiers CDDL doivent rester sous CDDL.',
      ],
    },
    recommendations: {
      en: [
        'Same compliance as CDDL-1.0: do not modify CDDL files unless prepared to disclose changes.',
        'Do not combine with GPL code.',
        'If using unmodified, safe for proprietary projects.',
      ],
      fr: [
        'Même conformité que CDDL-1.0 : ne pas modifier les fichiers CDDL sauf si vous êtes prêt à divulguer les changements.',
        'Ne pas combiner avec du code GPL.',
        'Si utilisé sans modification, sûr pour les projets propriétaires.',
      ],
    },
    url: 'https://spdx.org/licenses/CDDL-1.1.html',
  },
  'CPL-1.0': {
    name: 'Common Public License 1.0',
    description: {
      en: 'A module-level copyleft license created by IBM, predecessor of the Eclipse Public License. Modifications to CPL-licensed modules must be disclosed, but proprietary modules can be combined.',
      fr: "Une licence copyleft au niveau du module créée par IBM, prédécesseur de l'Eclipse Public License. Les modifications des modules sous CPL doivent être divulguées, mais les modules propriétaires peuvent être combinés.",
    },
    legalRisks: {
      en: [
        'Module-level copyleft: modifications to CPL-licensed modules must be disclosed.',
        'Patent retaliation clause: patent litigation terminates your license.',
        'Largely replaced by EPL: fewer compliance resources available.',
        'Choice of law provisions: governed by the laws of the State of New York.',
      ],
      fr: [
        'Copyleft au niveau du module : les modifications des modules sous CPL doivent être divulguées.',
        'Clause de rétorsion de brevet : un litige de brevet résilie votre licence.',
        'Largement remplacée par l\'EPL : moins de ressources de conformité disponibles.',
        "Clauses de choix de loi : régi par les lois de l'État de New York.",
      ],
    },
    obligations: {
      en: [
        'Disclose source of modifications to CPL-licensed modules.',
        'Include copyright and license notices.',
      ],
      fr: [
        'Divulguer le code source des modifications des modules sous CPL.',
        'Inclure les avis de copyright et de licence.',
      ],
    },
    recommendations: {
      en: [
        'Prefer EPL-2.0 alternatives when available.',
        'If using unmodified CPL modules as dependencies, no source disclosure is required.',
        'If modifying CPL code, publish changes under CPL-1.0.',
      ],
      fr: [
        'Préférer les alternatives sous EPL-2.0 lorsque disponibles.',
        "Si vous utilisez des modules CPL non modifiés comme dépendances, aucune divulgation de source n'est requise.",
        'Si vous modifiez du code sous CPL, publiez les changements sous CPL-1.0.',
      ],
    },
    url: 'https://spdx.org/licenses/CPL-1.0.html',
  },
  'EUPL-1.1': {
    name: 'European Union Public License 1.1',
    description: {
      en: 'A copyleft license created by the European Commission, compatible with several other open-source licenses including GPL. Available in 22 EU languages with all translations being legally valid.',
      fr: "Une licence copyleft créée par la Commission européenne, compatible avec plusieurs autres licences open-source dont la GPL. Disponible en 22 langues de l'UE avec toutes les traductions juridiquement valides.",
    },
    legalRisks: {
      en: [
        'Copyleft obligation: derivative works must be licensed under EUPL or a compatible license (GPL-2.0, LGPL, MPL, etc.).',
        'Network use provision: some interpretations suggest network use may trigger disclosure obligations.',
        'Multi-language complexity: 22 official translations may create interpretation differences.',
        'Less commonly used outside Europe: limited precedent in non-EU jurisdictions.',
      ],
      fr: [
        'Obligation copyleft : les œuvres dérivées doivent être sous licence EUPL ou une licence compatible (GPL-2.0, LGPL, MPL, etc.).',
        "Disposition d'utilisation réseau : certaines interprétations suggèrent que l'utilisation réseau peut déclencher des obligations de divulgation.",
        "Complexité multilingue : 22 traductions officielles peuvent créer des différences d'interprétation.",
        'Moins couramment utilisée en dehors de l\'Europe : précédent limité dans les juridictions non-UE.',
      ],
    },
    obligations: {
      en: [
        'Disclose source code of derivative works.',
        'License derivative works under EUPL or a compatible license.',
        'Include copyright and license notices.',
      ],
      fr: [
        'Divulguer le code source des œuvres dérivées.',
        'Licencier les œuvres dérivées sous EUPL ou une licence compatible.',
        'Inclure les avis de copyright et de licence.',
      ],
    },
    recommendations: {
      en: [
        'Leverage the compatibility list: EUPL allows relicensing under GPL, LGPL, MPL, and others.',
        'Consider EUPL-1.2 for new projects as it has an updated compatibility list.',
        'If your organization operates in the EU, the EUPL may be well-suited for public sector projects.',
      ],
      fr: [
        'Exploiter la liste de compatibilité : l\'EUPL permet la re-licence sous GPL, LGPL, MPL et autres.',
        "Envisager l'EUPL-1.2 pour les nouveaux projets car elle a une liste de compatibilité mise à jour.",
        "Si votre organisation opère dans l'UE, l'EUPL peut être bien adaptée aux projets du secteur public.",
      ],
    },
    url: 'https://spdx.org/licenses/EUPL-1.1.html',
  },
  'EUPL-1.2': {
    name: 'European Union Public License 1.2',
    description: {
      en: 'The latest version of the European Union Public License, available in 23 EU languages. A copyleft license with a broad compatibility list allowing relicensing under GPL, LGPL, MPL, AGPL, and others.',
      fr: "La dernière version de la European Union Public License, disponible en 23 langues de l'UE. Une licence copyleft avec une large liste de compatibilité permettant la re-licence sous GPL, LGPL, MPL, AGPL et autres.",
    },
    legalRisks: {
      en: [
        'Copyleft obligation: derivative works must be licensed under EUPL or a compatible license.',
        'Network use provision: providing the software as a service may trigger disclosure obligations (similar to AGPL).',
        'Multi-language translations: all 23 language versions are legally valid, which may create interpretation nuances.',
        'Broad compatibility: while flexible, the compatibility list requires careful analysis to ensure proper relicensing.',
      ],
      fr: [
        'Obligation copyleft : les œuvres dérivées doivent être sous licence EUPL ou une licence compatible.',
        "Disposition d'utilisation réseau : fournir le logiciel en tant que service peut déclencher des obligations de divulgation (similaire à l'AGPL).",
        "Traductions multilingues : les 23 versions linguistiques sont juridiquement valides, ce qui peut créer des nuances d'interprétation.",
        'Large compatibilité : bien que flexible, la liste de compatibilité nécessite une analyse minutieuse pour assurer une re-licence correcte.',
      ],
    },
    obligations: {
      en: [
        'Disclose source code of derivative works.',
        'License derivative works under EUPL or a compatible license.',
        'Include copyright and license notices.',
        'Provide source code to network users if applicable.',
      ],
      fr: [
        'Divulguer le code source des œuvres dérivées.',
        'Licencier les œuvres dérivées sous EUPL ou une licence compatible.',
        'Inclure les avis de copyright et de licence.',
        'Fournir le code source aux utilisateurs réseau si applicable.',
      ],
    },
    recommendations: {
      en: [
        'Preferred over EUPL-1.1 for new projects.',
        'Leverage the broad compatibility list for relicensing flexibility.',
        'Be aware of the network use provision if deploying as a service.',
        'Well-suited for EU public sector projects.',
      ],
      fr: [
        "Préférée à l'EUPL-1.1 pour les nouveaux projets.",
        'Exploiter la large liste de compatibilité pour la flexibilité de re-licence.',
        "Être conscient de la disposition d'utilisation réseau si vous déployez en tant que service.",
        "Bien adaptée aux projets du secteur public de l'UE.",
      ],
    },
    url: 'https://spdx.org/licenses/EUPL-1.2.html',
  },
  'OSL-2.0': {
    name: 'Open Software License 2.0',
    description: {
      en: 'A copyleft license with a network use provision: external deployment (making the software available over a network) triggers source code disclosure obligations. Includes an express patent grant.',
      fr: "Une licence copyleft avec une disposition d'utilisation réseau : le déploiement externe (rendre le logiciel disponible via un réseau) déclenche des obligations de divulgation du code source. Inclut une concession de brevet expresse.",
    },
    legalRisks: {
      en: [
        'Network copyleft: making the software available over a network triggers source disclosure, not just traditional distribution.',
        'Patent retaliation clause: patent litigation terminates your license.',
        'Less commonly used: limited community precedent and compliance guidance.',
        'GPL-incompatible: cannot combine with GPL-licensed code.',
      ],
      fr: [
        'Copyleft réseau : rendre le logiciel disponible via un réseau déclenche la divulgation du source, pas seulement la distribution traditionnelle.',
        'Clause de rétorsion de brevet : un litige de brevet résilie votre licence.',
        'Moins couramment utilisée : précédent communautaire et conseils de conformité limités.',
        'Incompatible avec la GPL : ne peut pas être combinée avec du code sous GPL.',
      ],
    },
    obligations: {
      en: [
        'Disclose source code when distributing or deploying externally.',
        'License derivative works under OSL.',
        'Include copyright and license notices.',
      ],
      fr: [
        'Divulguer le code source lors de la distribution ou du déploiement externe.',
        'Licencier les œuvres dérivées sous OSL.',
        'Inclure les avis de copyright et de licence.',
      ],
    },
    recommendations: {
      en: [
        'Be aware that network deployment triggers copyleft: not just distribution.',
        'Prefer OSL-3.0 for clearer terms if you must use an OSL-licensed dependency.',
        'Do not combine with GPL code: they are incompatible.',
      ],
      fr: [
        'Savoir que le déploiement réseau déclenche le copyleft : pas seulement la distribution.',
        'Préférer OSL-3.0 pour des termes plus clairs si vous devez utiliser une dépendance sous OSL.',
        'Ne pas combiner avec du code GPL : ils sont incompatibles.',
      ],
    },
    url: 'https://spdx.org/licenses/OSL-2.0.html',
  },
  'OSL-2.1': {
    name: 'Open Software License 2.1',
    description: {
      en: 'A minor update to OSL-2.0 with refined language. Retains the network copyleft provision and express patent grant.',
      fr: "Une mise à jour mineure de l'OSL-2.0 avec un langage affiné. Conserve la disposition de copyleft réseau et la concession de brevet expresse.",
    },
    legalRisks: {
      en: [
        'Network copyleft: external deployment triggers source disclosure.',
        'Patent retaliation clause: patent litigation terminates your license.',
        'Less commonly used: limited precedent.',
        'GPL-incompatible: cannot combine with GPL code.',
      ],
      fr: [
        'Copyleft réseau : le déploiement externe déclenche la divulgation du source.',
        'Clause de rétorsion de brevet : un litige de brevet résilie votre licence.',
        'Moins couramment utilisée : précédent limité.',
        'Incompatible avec la GPL : ne peut pas être combinée avec du code GPL.',
      ],
    },
    obligations: {
      en: [
        'Disclose source code when distributing or deploying externally.',
        'License derivative works under OSL.',
        'Include copyright and license notices.',
      ],
      fr: [
        'Divulguer le code source lors de la distribution ou du déploiement externe.',
        'Licencier les œuvres dérivées sous OSL.',
        'Inclure les avis de copyright et de licence.',
      ],
    },
    recommendations: {
      en: [
        'Same compliance as OSL-2.0: network deployment triggers disclosure.',
        'Prefer OSL-3.0 for the latest terms.',
        'Do not combine with GPL code.',
      ],
      fr: [
        'Même conformité que OSL-2.0 : le déploiement réseau déclenche la divulgation.',
        'Préférer OSL-3.0 pour les termes les plus récents.',
        'Ne pas combiner avec du code GPL.',
      ],
    },
    url: 'https://spdx.org/licenses/OSL-2.1.html',
  },
  'OSL-3.0': {
    name: 'Open Software License 3.0',
    description: {
      en: 'The latest version of the Open Software License. A copyleft license with network use provision and express patent grant. External deployment triggers source code disclosure.',
      fr: "La dernière version de l'Open Software License. Une licence copyleft avec disposition d'utilisation réseau et concession de brevet expresse. Le déploiement externe déclenche la divulgation du code source.",
    },
    legalRisks: {
      en: [
        'Network copyleft: making the software available over a network triggers source disclosure obligations.',
        'Patent grant with retaliation: patent litigation terminates your license.',
        'GPL-incompatible: cannot combine with GPL-licensed code.',
        'Less commonly used: fewer compliance resources than GPL or AGPL.',
      ],
      fr: [
        'Copyleft réseau : rendre le logiciel disponible via un réseau déclenche les obligations de divulgation du source.',
        'Concession de brevet avec rétorsion : un litige de brevet résilie votre licence.',
        'Incompatible avec la GPL : ne peut pas être combinée avec du code sous GPL.',
        'Moins couramment utilisée : moins de ressources de conformité que la GPL ou l\'AGPL.',
      ],
    },
    obligations: {
      en: [
        'Disclose source code when distributing or deploying externally.',
        'License derivative works under OSL-3.0.',
        'Include copyright and license notices.',
      ],
      fr: [
        'Divulguer le code source lors de la distribution ou du déploiement externe.',
        'Licencier les œuvres dérivées sous OSL-3.0.',
        'Inclure les avis de copyright et de licence.',
      ],
    },
    recommendations: {
      en: [
        'Treat similarly to AGPL: network deployment triggers copyleft obligations.',
        'Do not combine with GPL code: they are incompatible.',
        'Isolate OSL components behind API boundaries if using in proprietary projects.',
        'Consult legal counsel before adopting in commercial SaaS products.',
      ],
      fr: [
        'Traiter de manière similaire à l\'AGPL : le déploiement réseau déclenche les obligations copyleft.',
        'Ne pas combiner avec du code GPL : ils sont incompatibles.',
        'Isoler les composants OSL derrière des frontières API si utilisé dans des projets propriétaires.',
        'Consulter un conseiller juridique avant d\'adopter dans des produits SaaS commerciaux.',
      ],
    },
    url: 'https://spdx.org/licenses/OSL-3.0.html',
  },
  'MS-RL': {
    name: 'Microsoft Reciprocal License',
    description: {
      en: 'A file-level copyleft license from Microsoft, similar to MPL. Modifications to MS-RL-licensed files must be disclosed, but proprietary files can be combined in the same project.',
      fr: "Une licence copyleft au niveau du fichier de Microsoft, similaire à la MPL. Les modifications de fichiers sous MS-RL doivent être divulguées, mais des fichiers propriétaires peuvent être combinés dans le même projet.",
    },
    legalRisks: {
      en: [
        'File-level copyleft: modifications to MS-RL-licensed source files must be disclosed under MS-RL.',
        'Patent grant included: but patent retaliation clause terminates rights if you sue.',
        'Less commonly used: limited community review and legal precedent.',
        'Platform ambiguity: some interpret the license as having Windows-centric terms.',
      ],
      fr: [
        'Copyleft au niveau du fichier : les modifications de fichiers source sous MS-RL doivent être divulguées sous MS-RL.',
        'Concession de brevet incluse : mais la clause de rétorsion de brevet résilie les droits si vous poursuivez.',
        'Moins couramment utilisée : révision communautaire et précédent juridique limités.',
        'Ambiguïté de plateforme : certains interprètent la licence comme ayant des termes centrés sur Windows.',
      ],
    },
    obligations: {
      en: [
        'Disclose source code of modified MS-RL-licensed files.',
        'Include copyright and license notices.',
        'Modifications to MS-RL files must stay under MS-RL.',
      ],
      fr: [
        'Divulguer le code source des fichiers MS-RL modifiés.',
        'Inclure les avis de copyright et de licence.',
        'Les modifications de fichiers MS-RL doivent rester sous MS-RL.',
      ],
    },
    recommendations: {
      en: [
        'If not modifying MS-RL files, you can use them freely in proprietary projects.',
        'Similar compliance approach as MPL: keep modified files separate and disclosed.',
        'Prefer MPL-2.0 alternatives when available for broader community support.',
      ],
      fr: [
        'Si vous ne modifiez pas les fichiers MS-RL, vous pouvez les utiliser librement dans des projets propriétaires.',
        'Approche de conformité similaire à la MPL : garder les fichiers modifiés séparés et divulgués.',
        'Préférer les alternatives sous MPL-2.0 lorsque disponibles pour un support communautaire plus large.',
      ],
    },
    url: 'https://spdx.org/licenses/MS-RL.html',
  },
  'GPL-2.0-or-later': {
    name: 'GNU General Public License v2.0 or later',
    description: {
      en: 'Same strong copyleft obligations as GPL-2.0-only, but the licensee can choose to comply with any later version of the GPL. This allows adopting GPL-3.0 terms which include patent grants and anti-tivoization protections.',
      fr: "Mêmes obligations copyleft fortes que la GPL-2.0-only, mais le licencié peut choisir de se conformer à toute version ultérieure de la GPL. Cela permet d'adopter les termes de la GPL-3.0 qui incluent des concessions de brevet et des protections anti-tivoisation.",
    },
    legalRisks: {
      en: [
        'Strong copyleft: incorporating GPL code makes the entire combined work a derivative that must be distributed under GPL.',
        'Version flexibility: the "or later" clause means licensees can choose GPL-3.0 terms, which add anti-tivoization and patent clauses.',
        'License incompatibility: GPL-2.0 is incompatible with many other licenses, though the "or later" clause allows upgrading to GPL-3.0 for Apache-2.0 compatibility.',
        'No explicit patent grant in GPL-2.0: but choosing GPL-3.0 terms provides one.',
      ],
      fr: [
        "Copyleft fort : incorporer du code GPL rend l'ensemble du travail combiné un dérivé qui doit être distribué sous GPL.",
        "Flexibilité de version : la clause « ou ultérieure » signifie que les licenciés peuvent choisir les termes de la GPL-3.0, qui ajoutent l'anti-tivoisation et des clauses de brevet.",
        'Incompatibilité de licence : la GPL-2.0 est incompatible avec de nombreuses autres licences, bien que la clause « ou ultérieure » permette la mise à niveau vers la GPL-3.0 pour la compatibilité avec Apache-2.0.',
        'Aucune concession de brevet explicite dans la GPL-2.0 : mais le choix des termes de la GPL-3.0 en fournit une.',
      ],
    },
    obligations: {
      en: [
        'Disclose entire source code of the combined work.',
        'Distribute under GPL-2.0 or any later version.',
        'Include copyright and license notices.',
        'State changes made to the original code.',
      ],
      fr: [
        "Divulguer l'intégralité du code source du travail combiné.",
        'Distribuer sous GPL-2.0 ou toute version ultérieure.',
        'Inclure les avis de copyright et de licence.',
        'Indiquer les modifications apportées au code original.',
      ],
    },
    recommendations: {
      en: [
        'Avoid including in proprietary or commercial software that will be distributed.',
        'The "or later" clause provides flexibility to use GPL-3.0 terms for Apache-2.0 compatibility.',
        'Isolate GPL components in separate processes with API boundaries if needed.',
        'Consult legal counsel before use in any distributed product.',
      ],
      fr: [
        'Éviter d\'inclure dans des logiciels propriétaires ou commerciaux destinés à être distribués.',
        'La clause « ou ultérieure » offre la flexibilité d\'utiliser les termes de la GPL-3.0 pour la compatibilité avec Apache-2.0.',
        'Isoler les composants GPL dans des processus séparés avec des frontières API si nécessaire.',
        'Consulter un conseiller juridique avant utilisation dans tout produit distribué.',
      ],
    },
    url: 'https://spdx.org/licenses/GPL-2.0-or-later.html',
  },
  'GPL-3.0-or-later': {
    name: 'GNU General Public License v3.0 or later',
    description: {
      en: 'Same strong copyleft obligations as GPL-3.0-only, but the licensee can choose to comply with any later version of the GPL. Includes patent grants and anti-tivoization protections.',
      fr: "Mêmes obligations copyleft fortes que la GPL-3.0-only, mais le licencié peut choisir de se conformer à toute version ultérieure de la GPL. Inclut des concessions de brevet et des protections anti-tivoisation.",
    },
    legalRisks: {
      en: [
        'Strong copyleft: your entire project must be GPL if you incorporate GPL-3.0 code.',
        'Anti-tivoization clause: must provide installation instructions for modified versions on consumer hardware.',
        'Patent retaliation: suing for patent infringement terminates all rights.',
        'Version flexibility: future GPL versions may introduce additional obligations.',
      ],
      fr: [
        "Copyleft fort : l'ensemble de votre projet doit être GPL si vous incorporez du code GPL-3.0.",
        "Clause anti-tivoisation : il faut fournir les instructions d'installation pour les versions modifiées sur le matériel grand public.",
        'Rétorsion de brevet : poursuivre pour contrefaçon de brevet résilie tous les droits.',
        'Flexibilité de version : les futures versions GPL peuvent introduire des obligations supplémentaires.',
      ],
    },
    obligations: {
      en: [
        'Disclose entire source code of the combined work.',
        'Distribute under GPL-3.0 or any later version.',
        'Include copyright and license notices.',
        'State changes made to the code.',
        'Provide installation instructions for the target platform.',
      ],
      fr: [
        "Divulguer l'intégralité du code source du travail combiné.",
        'Distribuer sous GPL-3.0 ou toute version ultérieure.',
        'Inclure les avis de copyright et de licence.',
        'Indiquer les modifications apportées au code.',
        "Fournir les instructions d'installation pour la plateforme cible.",
      ],
    },
    recommendations: {
      en: [
        'Avoid in proprietary projects: the copyleft obligation requires open-sourcing your entire codebase upon distribution.',
        'If needed, isolate GPL-3.0 components as separate processes with API boundaries.',
        'The "or later" clause means future GPL versions may apply: monitor GPL developments.',
        'Consult legal counsel before integrating into commercial products.',
      ],
      fr: [
        "Éviter dans les projets propriétaires : l'obligation copyleft nécessite l'open-sourcing de toute votre base de code lors de la distribution.",
        'Si nécessaire, isoler les composants GPL-3.0 comme des processus séparés avec des frontières API.',
        'La clause « ou ultérieure » signifie que les futures versions GPL peuvent s\'appliquer : surveiller les évolutions de la GPL.',
        'Consulter un conseiller juridique avant d\'intégrer dans des produits commerciaux.',
      ],
    },
    url: 'https://spdx.org/licenses/GPL-3.0-or-later.html',
  },
  'AGPL-3.0-or-later': {
    name: 'GNU Affero General Public License v3.0 or later',
    description: {
      en: 'Same obligations as AGPL-3.0-only, the strongest copyleft including network use disclosure, but the licensee can choose to comply with any later version of the AGPL.',
      fr: "Mêmes obligations que l'AGPL-3.0-only, le copyleft le plus fort incluant la divulgation en cas d'utilisation réseau, mais le licencié peut choisir de se conformer à toute version ultérieure de l'AGPL.",
    },
    legalRisks: {
      en: [
        'Network copyleft: users interacting with the software over a network triggers source disclosure, even without traditional distribution.',
        'Full codebase exposure: incorporating AGPL code may require releasing the entire application source under AGPL.',
        'Patent retaliation: same as GPL-3.0.',
        'Version flexibility: future AGPL versions may introduce additional obligations.',
        'Many organizations explicitly prohibit AGPL dependencies.',
      ],
      fr: [
        "Copyleft réseau : les utilisateurs interagissant avec le logiciel via un réseau déclenchent la divulgation du source, même sans distribution traditionnelle.",
        "Exposition complète du code : incorporer du code AGPL peut exiger la publication du code source de l'ensemble de l'application sous AGPL.",
        'Rétorsion de brevet : identique à la GPL-3.0.',
        'Flexibilité de version : les futures versions AGPL peuvent introduire des obligations supplémentaires.',
        "De nombreuses organisations interdisent explicitement les dépendances AGPL.",
      ],
    },
    obligations: {
      en: [
        'Disclose entire source code of the combined work.',
        'Distribute under AGPL-3.0 or any later version.',
        'Provide source code to network users (SaaS/web).',
        'Include copyright and license notices.',
        'State changes made to the code.',
      ],
      fr: [
        "Divulguer l'intégralité du code source du travail combiné.",
        'Distribuer sous AGPL-3.0 ou toute version ultérieure.',
        'Fournir le code source aux utilisateurs réseau (SaaS/web).',
        'Inclure les avis de copyright et de licence.',
        'Indiquer les modifications apportées au code.',
      ],
    },
    recommendations: {
      en: [
        'Do not include AGPL dependencies in commercial SaaS products without full legal review.',
        'Isolate AGPL components in completely separate services with strict API boundaries.',
        'The "or later" clause means future AGPL versions may apply: add AGPL to your license deny-list.',
        'Consider replacing with permissively-licensed alternatives.',
      ],
      fr: [
        "Ne pas inclure de dépendances AGPL dans les produits SaaS commerciaux sans un examen juridique complet.",
        "Isoler les composants AGPL dans des services complètement séparés avec des frontières API strictes.",
        'La clause « ou ultérieure » signifie que les futures versions AGPL peuvent s\'appliquer : ajouter l\'AGPL à votre liste de licences interdites.',
        'Envisager de remplacer par des alternatives sous licence permissive.',
      ],
    },
    url: 'https://spdx.org/licenses/AGPL-3.0-or-later.html',
  },
  'SSPL-1.0': {
    name: 'Server Side Public License v1',
    description: {
      en: 'Created by MongoDB. The strongest copyleft license: if you offer the software as a service, you must release the source code of your entire service stack including management, orchestration, monitoring, APIs, and all supporting infrastructure. Not OSI-approved and considered non-free by Debian, Fedora, and Red Hat.',
      fr: "Créée par MongoDB. La licence copyleft la plus forte : si vous offrez le logiciel en tant que service, vous devez publier le code source de l'intégralité de votre pile de services, y compris la gestion, l'orchestration, la surveillance, les API et toute l'infrastructure de support. Non approuvée par l'OSI et considérée comme non-libre par Debian, Fedora et Red Hat.",
    },
    legalRisks: {
      en: [
        'Extreme service copyleft: offering the software as a service requires releasing the source code of your ENTIRE service stack (management, orchestration, monitoring, APIs, deployment, everything), not just the modified software.',
        'Not OSI-approved: considered non-free by Debian, Fedora, and Red Hat, which may conflict with organizational open-source policies.',
        'Unprecedented scope: the "service stack" disclosure requirement has no clear legal precedent and its boundaries are untested.',
        'GPL-incompatible: cannot be combined with GPL-licensed code.',
      ],
      fr: [
        "Copyleft de service extrême : offrir le logiciel en tant que service exige la publication du code source de l'INTÉGRALITÉ de votre pile de services (gestion, orchestration, surveillance, API, déploiement, tout), pas seulement le logiciel modifié.",
        "Non approuvée par l'OSI : considérée comme non-libre par Debian, Fedora et Red Hat, ce qui peut entrer en conflit avec les politiques open-source organisationnelles.",
        "Portée sans précédent : l'exigence de divulgation de la « pile de services » n'a pas de précédent juridique clair et ses limites n'ont pas été testées.",
        'Incompatible avec la GPL : ne peut pas être combinée avec du code sous GPL.',
      ],
    },
    obligations: {
      en: [
        'If offering as a service, release source code of the entire service stack.',
        'Disclose source code of modifications.',
        'Include copyright and license notices.',
        'State changes made to the code.',
      ],
      fr: [
        "Si vous offrez en tant que service, publier le code source de l'intégralité de la pile de services.",
        'Divulguer le code source des modifications.',
        'Inclure les avis de copyright et de licence.',
        'Indiquer les modifications apportées au code.',
      ],
    },
    recommendations: {
      en: [
        'Do not use SSPL-licensed software in any SaaS or cloud service without full legal review.',
        'The service stack disclosure requirement is extremely broad: it may require releasing proprietary infrastructure code.',
        'Add SSPL to your organization\'s license deny-list.',
        'Consider alternatives with less restrictive licenses (e.g., PostgreSQL instead of MongoDB).',
      ],
      fr: [
        "Ne pas utiliser de logiciel sous SSPL dans tout service SaaS ou cloud sans un examen juridique complet.",
        "L'exigence de divulgation de la pile de services est extrêmement large : elle peut nécessiter la publication du code d'infrastructure propriétaire.",
        'Ajouter la SSPL à la liste de licences interdites de votre organisation.',
        'Envisager des alternatives avec des licences moins restrictives (ex. PostgreSQL au lieu de MongoDB).',
      ],
    },
    url: 'https://www.mongodb.com/licensing/server-side-public-license',
  },
};

export function getLicenseDescription(spdxId: string): LicenseDescription | null {
  return licenseDescriptions[spdxId] || null;
}

export default licenseDescriptions;
