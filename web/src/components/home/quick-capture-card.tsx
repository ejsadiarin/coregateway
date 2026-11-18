import { Link } from 'react-router-dom';
import { MessageSquareText, PenTool, Plus, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function QuickCaptureCard({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Quick capture</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="max-md:h-11">
          <Link to="/dashboard/budget?openExpense=true">
            <Plus className="h-4 w-4" /> Add expense
          </Link>
        </Button>
        <Button asChild variant="outline" className="max-md:h-11">
          <Link to="/dashboard/feed">
            <MessageSquareText className="h-4 w-4" /> Write a note
          </Link>
        </Button>
        <Button asChild variant="outline" className="max-md:h-11">
          <Link to="/dashboard/draw">
            <PenTool className="h-4 w-4" /> New board
          </Link>
        </Button>
        <Button asChild variant="ghost" className="max-md:h-11">
          <Link to="/dashboard/budget">
            <Wallet className="h-4 w-4" /> Budget
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
