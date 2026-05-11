/**
 * Citation Worthiness Scorer.
 *
 * Ocenia jak bardzo strona jest "cytowalna" przez LLM. Bazuje na 7 osiach
 * udokumentowanych w research:
 *
 *   1. Stats density        — Wellows 2025: 19+ stat points = 5.4 vs 2.8 citations
 *   2. Expert quotes        — SE Journal: quotes = 4.1 vs 2.4 citations avg
 *   3. Unique claims        — Indig 30M: unique data 3-4x norma cytowane
 *   4. Entity density       — Indig: cited content 20.6% vs 5-8% norma
 *   5. Question coverage    — Surfer: question marks 2x częściej cytowane
 *                           — SE Land: heading questions = 78.4% cited
 *   6. Freshness           — SE Land: 25.7% AI cites fresher; 30-89 dni najlepiej
 *   7. Schema completeness — Rankeo 2026: JSON-LD = 3.2x AI citations
 *
 * Output: score 0-100 per page + 7 sub-scores + konkretne recommendations.
 */

import type { ExtractedContent } from '../../types/index.js';

export interface CitationScore {
  /** Overall score 0-100 */
  overall: number;
  /** Grade A-F */
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  /** Per-axis breakdown */
  axes: {
    statsDensity: AxisScore;
    expertQuotes: AxisScore;
    uniqueClaims: AxisScore;
    entityDensity: AxisScore;
    questionCoverage: AxisScore;
    freshness: AxisScore;
    schemaCompleteness: AxisScore;
  };
  /** Top 5 konkretnych recommendations (sortowane impact desc) */
  recommendations: Recommendation[];
}

export interface AxisScore {
  /** Sub-score 0-100 */
  score: number;
  /** Metric value (np. "12 stats" lub "20.6% entity density") */
  measured: string;
  /** Target value z research */
  target: string;
  /** Citation źródła */
  citation: string;
}

export interface Recommendation {
  axis: keyof CitationScore['axes'];
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Co robi zmiana (jednym zdaniem) */
  action: string;
  /** Konkretny przykład co dodać */
  example: string;
  /** Spodziewany lift (z research) */
  expectedLift: string;
  /** Estymowany impact w score points */
  impact: number;
}

export interface ScoreOptions {
  content: ExtractedContent;
  /** Liczba schema typów wykrytych w head */
  schemaTypesCount?: number;
  /** Czy strona ma FAQPage schema */
  hasFaqSchema?: boolean;
  /** Czy strona ma Person/author schema */
  hasPersonSchema?: boolean;
  /** Czy strona ma Speakable */
  hasSpeakable?: boolean;
  /** Last modified date (ISO) */
  lastModified?: string;
  /** Język strony (PL vs EN target różne) */
  lang?: string;
}

export class CitationScorer {
  score(opts: ScoreOptions): CitationScore {
    const axes = {
      statsDensity: this.scoreStats(opts.content),
      expertQuotes: this.scoreQuotes(opts.content),
      uniqueClaims: this.scoreUniqueClaims(opts.content),
      entityDensity: this.scoreEntities(opts.content),
      questionCoverage: this.scoreQuestions(opts.content),
      freshness: this.scoreFreshness(opts.lastModified),
      schemaCompleteness: this.scoreSchema(opts),
    };

    // Wagi: zgodne z impact z research (stats + quotes + schema = strongest)
    const weights = {
      statsDensity: 0.18,
      expertQuotes: 0.15,
      uniqueClaims: 0.13,
      entityDensity: 0.15,
      questionCoverage: 0.13,
      freshness: 0.10,
      schemaCompleteness: 0.16,
    };

    const overall = Math.round(
      Object.entries(axes).reduce((sum, [key, val]) => sum + val.score * weights[key as keyof typeof weights], 0),
    );

    const grade: CitationScore['grade'] =
      overall >= 95 ? 'A+' : overall >= 85 ? 'A' : overall >= 70 ? 'B' : overall >= 55 ? 'C' : overall >= 40 ? 'D' : 'F';

    const recommendations = this.buildRecommendations(axes, opts);

    return { overall, grade, axes, recommendations };
  }

  private scoreStats(content: ExtractedContent): AxisScore {
    const count = content.stats.length;
    // 0-4 stats: 0-25 score, 5-18: 25-75, 19+: 75-100
    let score: number;
    if (count >= 19) score = Math.min(100, 75 + (count - 19) * 1.5);
    else if (count >= 5) score = 25 + ((count - 5) / 14) * 50;
    else score = (count / 5) * 25;
    return {
      score: Math.round(score),
      measured: `${count} stats/data points`,
      target: '19+ stats (Wellows 2025: 5.4 vs 2.8 citations)',
      citation: 'wellows.com — 19+ statistics correlates with 5.4 avg AI citations vs 2.8 baseline',
    };
  }

  private scoreQuotes(content: ExtractedContent): AxisScore {
    const count = content.quotes.length;
    const withAttribution = content.quotes.filter((q) => q.attribution).length;
    // 0-1 quote: low; 2-4: mid; 5+ z attribution: high
    let score: number;
    if (count >= 5 && withAttribution >= 3) score = 100;
    else if (count >= 3 && withAttribution >= 2) score = 75;
    else if (count >= 1) score = 40 + withAttribution * 15;
    else score = 0;
    return {
      score: Math.min(100, Math.round(score)),
      measured: `${count} quotes (${withAttribution} z atrybucją)`,
      target: '3+ expert quotes z atrybucją (Search Engine Journal)',
      citation: 'SEJ: expert quotes correlate with 4.1 vs 2.4 AI citations avg',
    };
  }

  private scoreUniqueClaims(content: ExtractedContent): AxisScore {
    // Heurystyka: unique claims = stats z source URL + entity-dense paragraphs
    const sourcedStats = content.stats.filter((s) => s.source).length;
    const totalStats = content.stats.length;
    const authoritativeLinks = content.outboundLinks.filter((l) => l.isAuthoritative).length;
    // Mix: sourced stats + authoritative outbound links
    const score = Math.min(100, sourcedStats * 8 + authoritativeLinks * 5);
    return {
      score: Math.round(score),
      measured: `${sourcedStats}/${totalStats} sourced stats + ${authoritativeLinks} authoritative outbound links`,
      target: '3+ sourced stats + 5+ authoritative outbound links',
      citation: 'Indig 30M citations: unique data 3-4× more cited than compiled content',
    };
  }

  private scoreEntities(content: ExtractedContent): AxisScore {
    const density = content.metrics.entityDensityPct;
    // Norma: 5-8%. Target: 18-22%. Cap z research: 20.6%.
    let score: number;
    if (density >= 20) score = 100;
    else if (density >= 15) score = 75 + ((density - 15) / 5) * 25;
    else if (density >= 8) score = 50 + ((density - 8) / 7) * 25;
    else score = (density / 8) * 50;
    return {
      score: Math.round(score),
      measured: `${density.toFixed(1)}% entity density (${content.entities.length} entities)`,
      target: '20%+ density (Indig 30M)',
      citation: 'Indig 30M citations: cited content avg 20.6% entity density vs 5-8% norma',
    };
  }

  private scoreQuestions(content: ExtractedContent): AxisScore {
    const qMarks = content.metrics.questionMarksCount;
    const h3QPct = content.metrics.h3QuestionsPct;
    const questionHeadings = content.headings.filter((h) => h.isQuestion).length;
    // Multi-factor: pytajniki w treści + headings z pytaniami
    let score = 0;
    score += Math.min(40, qMarks * 4); // up to 40 pts from question marks
    score += Math.min(30, h3QPct * 0.3); // up to 30 pts from H3 questions
    score += Math.min(30, questionHeadings * 6); // up to 30 pts from any question headings
    return {
      score: Math.round(Math.min(100, score)),
      measured: `${qMarks} pytajniki + ${questionHeadings} question headings (H3: ${h3QPct}%)`,
      target: '5+ pytajniki + 50%+ H3 jako pytania',
      citation: 'Surfer SEO: questions 2× cited. SE Land Indig: question headings 78.4% cited content',
    };
  }

  private scoreFreshness(lastModified?: string): AxisScore {
    if (!lastModified) {
      return {
        score: 20,
        measured: 'no datePublished/dateModified',
        target: 'datePublished + dateModified w schema, fresh < 90 dni',
        citation: 'SE Land: 25.7% AI cites fresher content; 30-89 dni performuje najlepiej',
      };
    }
    const ageDays = (Date.now() - new Date(lastModified).getTime()) / 86_400_000;
    let score: number;
    if (ageDays < 30) score = 90;
    else if (ageDays < 90) score = 100; // peak window
    else if (ageDays < 180) score = 75;
    else if (ageDays < 365) score = 55;
    else if (ageDays < 730) score = 35;
    else score = 20;
    return {
      score: Math.round(score),
      measured: `${Math.floor(ageDays)} dni od ostatniej modyfikacji`,
      target: '30-89 dni (peak window)',
      citation: 'SE Land: pages 30-89 dni performują najlepiej, >2 lat dramatyczny spadek',
    };
  }

  private scoreSchema(opts: ScoreOptions): AxisScore {
    const typesCount = opts.schemaTypesCount ?? 0;
    // Critical types: Organization, WebSite, Article/Product/Service, BreadcrumbList, Person, FAQPage
    let score = 0;
    if (typesCount >= 1) score += 15; // jakiś schema
    if (typesCount >= 3) score += 20; // tier 1 complete
    if (typesCount >= 5) score += 20; // tier 2 included
    if (opts.hasFaqSchema) score += 20; // FAQPage = 3.2x AI Overviews
    if (opts.hasPersonSchema) score += 15; // E-E-A-T
    if (opts.hasSpeakable) score += 10; // +127% voice referrals
    return {
      score: Math.min(100, score),
      measured: `${typesCount} schema types, FAQPage=${!!opts.hasFaqSchema}, Person=${!!opts.hasPersonSchema}, Speakable=${!!opts.hasSpeakable}`,
      target: '5+ types incl. FAQPage + Person + Speakable',
      citation: 'Rankeo 2026: JSON-LD = 3.2× AI citations. ALM 2026-05-07: FAQPage 3.2× AI Overviews.',
    };
  }

  private buildRecommendations(
    axes: CitationScore['axes'],
    opts: ScoreOptions,
  ): Recommendation[] {
    const recs: Recommendation[] = [];

    if (axes.statsDensity.score < 75) {
      const need = Math.max(0, 19 - opts.content.stats.length);
      recs.push({
        axis: 'statsDensity',
        priority: axes.statsDensity.score < 25 ? 'critical' : 'high',
        action: `Dodaj ${need} statystyk/liczb do treści`,
        example: 'np. "44.2% citations pochodzi z pierwszych 30% treści (Indig, 30M sample)" lub "wzrost o 23% rok-do-roku"',
        expectedLift: '5.4 vs 2.8 AI citations avg po 19+ stats',
        impact: 75 - axes.statsDensity.score,
      });
    }

    if (axes.expertQuotes.score < 75) {
      recs.push({
        axis: 'expertQuotes',
        priority: axes.expertQuotes.score < 25 ? 'high' : 'medium',
        action: 'Dodaj 3+ cytaty ekspertów z atrybucją',
        example: '<blockquote>"Cytat..."<cite>— Jan Kowalski, CTO Acme</cite></blockquote> + Person schema dla każdego cytowanego',
        expectedLift: '4.1 vs 2.4 AI citations avg',
        impact: 75 - axes.expertQuotes.score,
      });
    }

    if (axes.uniqueClaims.score < 60) {
      recs.push({
        axis: 'uniqueClaims',
        priority: 'high',
        action: 'Dodaj sourced stats + linki do autorytatywnych źródeł (Wikipedia, .gov, .edu, arXiv)',
        example: '<a href="https://arxiv.org/abs/2506.11097">NeurIPS 2025 C-SEO Bench</a> jako reference, plus unique data point twojej marki',
        expectedLift: '3-4× cytowanie unique data vs compiled content (Indig)',
        impact: 60 - axes.uniqueClaims.score,
      });
    }

    if (axes.entityDensity.score < 70) {
      recs.push({
        axis: 'entityDensity',
        priority: 'high',
        action: 'Zwiększ gęstość proper nouns (marki, miejsca, osoby, technologie)',
        example: 'Zamiast "narzędzie", napisz "narzędzie [Marka] dla [Branża] w [Mieście] zbudowane na [Technologia]"',
        expectedLift: '3-4× cytowanie (Indig: cited 20.6% vs norma 5-8%)',
        impact: 70 - axes.entityDensity.score,
      });
    }

    if (axes.questionCoverage.score < 70) {
      recs.push({
        axis: 'questionCoverage',
        priority: 'high',
        action: 'Przekuj 50%+ H3 na pytania + dodaj FAQ sekcję',
        example: 'Zmień "Cena produktu" na "Ile kosztuje [produkt]?". Dodaj 5-10 FAQ z prawdziwymi pytaniami z PAA',
        expectedLift: 'Headings-questions: 78.4% cited content (SE Land Indig)',
        impact: 70 - axes.questionCoverage.score,
      });
    }

    if (axes.freshness.score < 75) {
      recs.push({
        axis: 'freshness',
        priority: axes.freshness.score < 35 ? 'critical' : 'medium',
        action: 'Refresh treści — dodaj datePublished + dateModified',
        example: 'W schema Article dodaj "dateModified": "2026-05-15". Update content z najnowszymi liczbami (research z ostatnich 90 dni).',
        expectedLift: '25.7% więcej cited (SE Land)',
        impact: 75 - axes.freshness.score,
      });
    }

    if (axes.schemaCompleteness.score < 80) {
      const missing: string[] = [];
      if (!opts.hasFaqSchema) missing.push('FAQPage (+3.2× AI Overviews)');
      if (!opts.hasPersonSchema) missing.push('Person z hasCredential (E-E-A-T)');
      if (!opts.hasSpeakable) missing.push('SpeakableSpecification (+127% voice)');
      recs.push({
        axis: 'schemaCompleteness',
        priority: 'high',
        action: `Uzupełnij schema: ${missing.join(', ')}`,
        example: '<script type="application/ld+json">{"@type":"FAQPage","mainEntity":[...]}</script>',
        expectedLift: '3.2× AI citations z complete @graph',
        impact: 80 - axes.schemaCompleteness.score,
      });
    }

    // Sort by impact desc, top 5
    return recs.sort((a, b) => b.impact - a.impact).slice(0, 5);
  }
}

export function scoreCitation(opts: ScoreOptions): CitationScore {
  return new CitationScorer().score(opts);
}
