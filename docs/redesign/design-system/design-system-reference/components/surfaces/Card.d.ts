import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

/**
 * The base container: white fill, 1px border, 6px radius, no shadow — structure
 * comes from the border. Compose Card > CardHeader (CardTitle, CardDescription)
 * > CardContent > CardFooter. 16px shared inset.
 *
 * Adherence: never add a drop shadow; dividers inside use --color-border-subtle.
 *
 * @startingPoint section="Surfaces" subtitle="Base container + header/content/footer" viewport="700x220"
 */
export function Card(props: CardProps): JSX.Element;
export function CardHeader(props: CardProps): JSX.Element;
export function CardTitle(props: CardProps): JSX.Element;
export function CardDescription(props: CardProps): JSX.Element;
export function CardContent(props: CardProps): JSX.Element;
export function CardFooter(props: CardProps): JSX.Element;
