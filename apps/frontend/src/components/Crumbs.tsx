import type { ReactNode } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbVariants,
} from "#/components/starwind/breadcrumb";

/** parent には <Link className={crumbLinkClass}> を渡す（画面を読み込み直さずに移動するため） */
export const crumbLinkClass = BreadcrumbVariants.breadcrumbLink();

export function Crumbs({
  parent,
  current,
}: {
  parent: ReactNode;
  current: string;
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>{parent}</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
